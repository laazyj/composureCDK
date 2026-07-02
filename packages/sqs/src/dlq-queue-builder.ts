import type { IQueue, QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { QueueBuilderExtensionProps } from "./queue-props.js";
import { QUEUE_DEFAULTS } from "./defaults.js";
import { DLQ_QUEUE_DEFAULTS } from "./dlq-defaults.js";
import { dlqAlarmProfile } from "./queue-alarm-profiles.js";
import { buildQueueResult, type QueueBuilderResult } from "./build-queue.js";
import { throwIfRedriveOnDlq, validateFifoQueueProps } from "./queue-validation.js";

/**
 * Configuration properties for the dead-letter queue builder.
 *
 * Extends the CDK {@link QueueProps} with builder-specific options,
 * minus `deadLetterQueue` — a DLQ is the terminal destination for
 * failed messages and must not carry its own redrive policy.
 *
 * The FIFO props remain available: AWS requires the dead-letter queue
 * of a FIFO source queue to itself be FIFO, so set `.fifo(true)` (and a
 * `.fifo`-suffixed `queueName`, validated at build) when the DLQ serves
 * a FIFO queue.
 *
 * `recommendedAlarms` resolves against the dead-letter-queue defaults —
 * see {@link DLQ_ALARM_DEFAULTS}. Any message on a DLQ is itself the
 * alert, so `approximateNumberOfMessagesVisible` (> 0) and an age alarm
 * scaled to the retention period are enabled by default, while the
 * primary-queue in-flight alarm is not.
 */
export interface DlqQueueBuilderProps
  extends Omit<QueueProps, "deadLetterQueue">, QueueBuilderExtensionProps {}

/**
 * A fluent builder for configuring and creating an AWS SQS dead-letter
 * queue.
 *
 * Mirrors {@link createQueueBuilder | the standard queue builder} —
 * same secure defaults, same `Lifecycle` composition — with
 * DLQ-specific behaviour:
 *
 * - `retentionPeriod` defaults to 14 days, the SQS maximum
 *   ({@link DLQ_QUEUE_DEFAULTS}) — the queue exists to give operators
 *   an investigation and redrive window.
 * - The recommended-alarm set inverts ({@link DLQ_ALARM_DEFAULTS}):
 *   any visible message alarms (> 0), the age alarm fires at 75% of the
 *   retention period (last call before SQS deletes the message), and
 *   the in-flight alarm is off.
 * - `deadLetterQueue` is not settable — a DLQ is a terminal
 *   destination.
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
 *
 * @example
 * ```ts
 * const ordersDlq = createDlqQueueBuilder().queueName("orders-dlq");
 *
 * const orders = createQueueBuilder()
 *   .queueName("orders")
 *   .deadLetterQueue(ref("ordersDlq", (r) => ({ queue: r.queue, maxReceiveCount: 5 })));
 * ```
 */
export type IDlqQueueBuilder = ITaggedBuilder<DlqQueueBuilderProps, DlqQueueBuilder>;

class DlqQueueBuilder implements Lifecycle<QueueBuilderResult> {
  props: Partial<DlqQueueBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IQueue>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IQueue>) => AlarmDefinitionBuilder<IQueue>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: DlqQueueBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): QueueBuilderResult {
    const mergedProps = { ...QUEUE_DEFAULTS, ...DLQ_QUEUE_DEFAULTS, ...this.props };

    throwIfRedriveOnDlq(id, mergedProps);
    validateFifoQueueProps("DlqQueueBuilder", id, mergedProps);

    const profile = dlqAlarmProfile(scope, mergedProps.retentionPeriod);
    return buildQueueResult(scope, id, mergedProps, this.#customAlarms, profile);
  }
}

/**
 * Creates a new {@link IDlqQueueBuilder} for configuring an AWS SQS
 * dead-letter queue.
 *
 * The returned builder exposes every {@link DlqQueueBuilderProps}
 * property as a fluent setter/getter and implements {@link Lifecycle}
 * for use with {@link compose}. For the primary queues that redrive to
 * it, use {@link createQueueBuilder} or {@link createFifoQueueBuilder}.
 *
 * @returns A fluent builder for an AWS SQS dead-letter queue.
 *
 * @example
 * ```ts
 * // Standard DLQ, wired to its primary via compose + ref:
 * const system = compose(
 *   {
 *     ordersDlq: createDlqQueueBuilder(),
 *     orders: createQueueBuilder().deadLetterQueue(
 *       ref("ordersDlq", (r) => ({ queue: r.queue, maxReceiveCount: 5 })),
 *     ),
 *   },
 *   { ordersDlq: [], orders: ["ordersDlq"] },
 * );
 *
 * // FIFO DLQ for a FIFO source queue:
 * const orderEventsDlq = createDlqQueueBuilder()
 *   .queueName("order-events-dlq.fifo")
 *   .fifo(true);
 * ```
 */
export function createDlqQueueBuilder(): IDlqQueueBuilder {
  return taggedBuilder<DlqQueueBuilderProps, DlqQueueBuilder>(DlqQueueBuilder);
}
