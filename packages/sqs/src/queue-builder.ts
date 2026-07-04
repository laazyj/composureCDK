import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IQueue, Queue, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { QueueBuilderExtensionProps, QueueBuilderPropsByRole } from "./queue-props.js";
import { isDlqRole, isFifoRole, type QueueRole } from "./queue-role.js";
import { QUEUE_DEFAULTS } from "./defaults.js";
import { DLQ_QUEUE_DEFAULTS } from "./dlq-defaults.js";
import { dlqAlarmProfile, PRIMARY_ALARM_PROFILE } from "./queue-alarm-profiles.js";
import { createQueueAlarms } from "./queue-alarms.js";
import { validateQueueProps } from "./queue-validation.js";

/**
 * The build output of {@link createQueueBuilder}, identical across every
 * {@link QueueRole}. Contains the CDK constructs created during
 * {@link Lifecycle.build}, keyed by role.
 */
export interface QueueBuilderResult {
  /** The SQS queue construct created by the builder. */
  queue: Queue;

  /**
   * CloudWatch alarms created for the queue, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via `addAlarm`. Access individual alarms by key (e.g.,
   * `result.alarms.approximateAgeOfOldestMessage`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  alarms: Record<string, Alarm>;
}

/**
 * The builder's full internal prop store: the CDK {@link QueueProps},
 * the builder-only extensions, and the queue's role. The public surface
 * per role is the narrowed view in {@link QueueBuilderPropsByRole} —
 * this type exists so one `QueueBuilder` implementation can back every
 * role.
 */
interface InternalQueueBuilderProps extends QueueProps, QueueBuilderExtensionProps {
  /**
   * The queue's role, set by `createQueueBuilder(role)`. Stored as a
   * prop (not a private field) so it is data: `.copy()` preserves it
   * for free and it is inspectable on the builder.
   */
  queueRole?: QueueRole;
}

/**
 * A fluent builder for configuring and creating an AWS SQS queue in a
 * given {@link QueueRole}.
 *
 * Each configuration property applicable to the role is exposed as an
 * overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 * The prop surface is exact per role — FIFO-only props exist only on
 * the FIFO roles, and `deadLetterQueue` does not exist on the
 * dead-letter roles.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as
 * a component in a {@link compose | composed system}. When built, it
 * creates an SQS queue with the configured properties, the role's
 * defaults, and the role's recommended CloudWatch alarms, returning a
 * {@link QueueBuilderResult}.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html
 *
 * @example
 * ```ts
 * const orders = createQueueBuilder()
 *   .queueName("orders")
 *   .visibilityTimeout(Duration.seconds(60));
 *
 * const orderEvents = createQueueBuilder("fifo")
 *   .queueName("order-events.fifo")
 *   .contentBasedDeduplication(true);
 *
 * const ordersDlq = createQueueBuilder("dlq").queueName("orders-dlq");
 * ```
 */
export type IQueueBuilder<R extends QueueRole = "standard"> = ITaggedBuilder<
  QueueBuilderPropsByRole[R],
  QueueBuilder
>;

class QueueBuilder implements Lifecycle<QueueBuilderResult> {
  props: Partial<InternalQueueBuilderProps> = {};
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
    const { queueRole: role = "standard", ...configured } = this.props;
    const fifo = isFifoRole(role);
    const dlq = isDlqRole(role);

    const mergedProps = {
      ...QUEUE_DEFAULTS,
      ...(dlq ? DLQ_QUEUE_DEFAULTS : {}),
      ...configured,
      ...(fifo ? { fifo: true } : {}),
    };

    validateQueueProps(scope, id, role, mergedProps);

    const { recommendedAlarms, ...queueProps } = mergedProps;
    const queue = new Queue(scope, id, queueProps);

    const profile = dlq
      ? dlqAlarmProfile(scope, mergedProps.retentionPeriod)
      : PRIMARY_ALARM_PROFILE;
    const alarms = createQueueAlarms(
      scope,
      id,
      queue,
      recommendedAlarms,
      this.#customAlarms,
      profile,
    );

    return { queue, alarms };
  }
}

/**
 * Creates a new {@link IQueueBuilder} for configuring an AWS SQS queue
 * in the given role.
 *
 * This is the single entry point for every queue type. The role — see
 * {@link QueueRole} for the full catalogue — selects the builder's
 * typed prop surface, its Well-Architected defaults, its
 * recommended-alarm profile, and its build-time validation:
 *
 * - `createQueueBuilder()` / `createQueueBuilder("standard")` — primary
 *   standard queue.
 * - `createQueueBuilder("fifo")` — primary FIFO queue.
 * - `createQueueBuilder("dlq")` — standard dead-letter queue.
 * - `createQueueBuilder("fifo-dlq")` — FIFO dead-letter queue (the DLQ
 *   for a FIFO source must itself be FIFO).
 *
 * The returned builder exposes every prop applicable to the role as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @param role - The queue's role. Defaults to `"standard"`.
 * @returns A fluent builder for an AWS SQS queue in that role.
 *
 * @example
 * ```ts
 * // A FIFO primary queue redriving to a FIFO dead-letter queue:
 * const system = compose(
 *   {
 *     orderEventsDlq: createQueueBuilder("fifo-dlq").queueName("order-events-dlq.fifo"),
 *     orderEvents: createQueueBuilder("fifo")
 *       .queueName("order-events.fifo")
 *       .contentBasedDeduplication(true)
 *       .deadLetterQueue(ref("orderEventsDlq", (r) => ({ queue: r.queue, maxReceiveCount: 5 }))),
 *   },
 *   { orderEventsDlq: [], orderEvents: ["orderEventsDlq"] },
 * );
 * ```
 */
export function createQueueBuilder(): IQueueBuilder;
export function createQueueBuilder<R extends QueueRole>(role: R): IQueueBuilder<R>;
// Callers only ever see the overloads above, which return the exact
// per-role `IQueueBuilder<R>`. The `unknown` here types the implementation
// body alone (the internal builder carries the full prop surface, not the
// narrowed per-role one) and is never observed at a call site — so it does
// not weaken the type of a builder passed to `compose`.
export function createQueueBuilder(role: QueueRole = "standard"): unknown {
  const builder = taggedBuilder<InternalQueueBuilderProps, QueueBuilder>(QueueBuilder);
  (builder as unknown as { queueRole(role: QueueRole): unknown }).queueRole(role);
  return builder;
}
