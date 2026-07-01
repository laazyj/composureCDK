import { Annotations, Token } from "aws-cdk-lib";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IQueue, Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { QueueAlarmConfig } from "./queue-alarm-config.js";
import { createQueueAlarms } from "./queue-alarms.js";
import { QUEUE_DEFAULTS } from "./defaults.js";
import { DLQ_QUEUE_DEFAULTS } from "./dlq-defaults.js";
import type { QueueRole } from "./queue-role.js";

/**
 * AWS-recommended minimum for `maxReceiveCount` on an SQS redrive
 * policy. A consumer needs a few retries before SQS gives up and
 * forwards the message to the dead-letter queue; anything below this
 * tends to surface as a flood of "poison" messages from transient
 * errors that would have succeeded on retry.
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
 */
const RECOMMENDED_MIN_MAX_RECEIVE_COUNT = 5;

/**
 * Configuration properties for the SQS queue builder.
 *
 * Extends the CDK {@link QueueProps} with additional builder-specific options.
 */
export interface QueueBuilderProps extends QueueProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric. Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  recommendedAlarms?: QueueAlarmConfig | false;
}

/**
 * The build output of an {@link IQueueBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface QueueBuilderResult {
  /** The SQS queue construct created by the builder. */
  queue: Queue;

  /**
   * CloudWatch alarms created for the queue, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link IQueueBuilder.addAlarm}. Access individual alarms
   * by key (e.g., `result.alarms.approximateAgeOfOldestMessage`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS SQS queue.
 *
 * Each configuration property from the CDK {@link QueueProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an SQS queue with the configured properties and returns a
 * {@link QueueBuilderResult}.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default.
 * Alarms can be customized or disabled via the `recommendedAlarms` property.
 * Custom alarms can be added via the {@link addAlarm} method.
 *
 * Calling `.asDeadLetterQueue()` switches the builder into the
 * dead-letter-queue role: it applies {@link DLQ_QUEUE_DEFAULTS} (14-day
 * retention) and inverts which recommended alarms are enabled by default
 * — any message present becomes the alert, rather than a "consumer
 * falling behind" or "in-flight quota" signal that doesn't apply to a
 * queue nothing actively consumes from.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html
 *
 * @example
 * ```ts
 * const orders = createQueueBuilder()
 *   .queueName("orders")
 *   .visibilityTimeout(Duration.seconds(60));
 *
 * const ordersDlq = createQueueBuilder()
 *   .queueName("orders-dlq")
 *   .asDeadLetterQueue();
 * ```
 */
export type IQueueBuilder = ITaggedBuilder<QueueBuilderProps, QueueBuilder>;

class QueueBuilder implements Lifecycle<QueueBuilderResult> {
  props: Partial<QueueBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IQueue>[] = [];
  #role: QueueRole = "primary";

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IQueue>) => AlarmDefinitionBuilder<IQueue>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }

  /**
   * Switches the builder into the dead-letter-queue role: applies
   * {@link DLQ_QUEUE_DEFAULTS} (14-day retention) and enables the
   * dead-letter-queue recommended-alarm defaults (see
   * {@link DLQ_ALARM_DEFAULTS}) in place of the primary-queue ones.
   * Every default remains individually overridable through the
   * builder's usual fluent API.
   */
  asDeadLetterQueue(): this {
    this.#role = "dlq";
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: QueueBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
    target.#role = this.#role;
  }

  build(scope: IConstruct, id: string): QueueBuilderResult {
    const { recommendedAlarms: alarmConfig, ...queueProps } = this.props;

    const mergedProps = {
      ...QUEUE_DEFAULTS,
      ...(this.#role === "dlq" ? DLQ_QUEUE_DEFAULTS : {}),
      ...queueProps,
    } as QueueBuilderProps;

    warnIfLowMaxReceiveCount(scope, id, mergedProps);
    warnIfDlqHasRedrivePolicy(scope, id, this.#role, mergedProps);

    const queue = new Queue(scope, id, mergedProps);

    const alarms = createQueueAlarms(scope, id, queue, alarmConfig, this.#customAlarms, this.#role);

    return { queue, alarms };
  }
}

/**
 * Creates a new {@link IQueueBuilder} for configuring an AWS SQS queue.
 *
 * This is the entry point for defining an SQS queue component. The returned
 * builder exposes every {@link QueueBuilderProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an AWS SQS queue.
 *
 * @example
 * ```ts
 * const orders = createQueueBuilder()
 *   .queueName("orders")
 *   .visibilityTimeout(Duration.seconds(60));
 *
 * // Use standalone:
 * const result = orders.build(stack, "Orders");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { orders, alerts: createTopicBuilder() },
 *   { orders: [], alerts: [] },
 * );
 * ```
 */
export function createQueueBuilder(): IQueueBuilder {
  return taggedBuilder<QueueBuilderProps, QueueBuilder>(QueueBuilder);
}

/**
 * Annotates `scope` with a non-fatal warning when a redrive policy is
 * configured with `maxReceiveCount` below the AWS-recommended floor
 * of {@link RECOMMENDED_MIN_MAX_RECEIVE_COUNT}.
 *
 * The builder owns the redrive policy directly, so this is a true
 * check rather than a contextual reminder — the actual configured
 * value is compared. Short-circuits on unresolved tokens so stacks
 * that thread `maxReceiveCount` through CFN parameters aren't spammed.
 */
function warnIfLowMaxReceiveCount(
  scope: IConstruct,
  id: string,
  props: Partial<QueueBuilderProps>,
): void {
  const dlq = props.deadLetterQueue;
  if (!dlq) return;
  const maxReceiveCount = dlq.maxReceiveCount;
  if (Token.isUnresolved(maxReceiveCount)) return;
  if (maxReceiveCount >= RECOMMENDED_MIN_MAX_RECEIVE_COUNT) return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/sqs:redrive-low-max-receive-count",
    `QueueBuilder "${id}": redrive policy maxReceiveCount is ${String(maxReceiveCount)}; ` +
      `AWS recommends >= ${String(RECOMMENDED_MIN_MAX_RECEIVE_COUNT)} so the consumer ` +
      `has room to retry before messages hit the dead-letter queue. ` +
      `See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html`,
  );
}

/**
 * Annotates `scope` with a non-fatal warning when a queue built via
 * `.asDeadLetterQueue()` also configures its own redrive policy
 * (`deadLetterQueue`). A dead-letter queue is meant to be a terminal
 * destination for failed messages — redriving from it to yet another
 * queue is almost always unintended.
 */
function warnIfDlqHasRedrivePolicy(
  scope: IConstruct,
  id: string,
  role: QueueRole,
  props: Partial<QueueBuilderProps>,
): void {
  if (role !== "dlq") return;
  if (!props.deadLetterQueue) return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/sqs:dlq-with-redrive-policy",
    `QueueBuilder "${id}": built via asDeadLetterQueue() but also configures its own ` +
      `deadLetterQueue redrive policy. A dead-letter queue is meant to be a terminal ` +
      `destination for failed messages — redriving from it to another queue is unusual ` +
      `and likely unintended.`,
  );
}
