import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IQueue, Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { QueueAlarmConfig } from "./queue-alarm-config.js";
import { createQueueAlarms } from "./queue-alarms.js";
import { QUEUE_DEFAULTS } from "./defaults.js";

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
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html
 *
 * @example
 * ```ts
 * const orders = createQueueBuilder()
 *   .queueName("orders")
 *   .visibilityTimeout(Duration.seconds(60));
 * ```
 */
export type IQueueBuilder = ITaggedBuilder<QueueBuilderProps, QueueBuilder>;

class QueueBuilder implements Lifecycle<QueueBuilderResult> {
  props: Partial<QueueBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IQueue>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IQueue>) => AlarmDefinitionBuilder<IQueue>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: QueueBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): QueueBuilderResult {
    const { recommendedAlarms: alarmConfig, ...queueProps } = this.props;

    const mergedProps = {
      ...QUEUE_DEFAULTS,
      ...queueProps,
    } as QueueBuilderProps;

    const queue = new Queue(scope, id, mergedProps);

    const alarms = createQueueAlarms(scope, id, queue, alarmConfig, this.#customAlarms);

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
