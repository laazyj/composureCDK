import type { IQueue, QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { FifoQueueName, QueueBuilderExtensionProps } from "./queue-props.js";
import { QUEUE_DEFAULTS } from "./defaults.js";
import { PRIMARY_ALARM_PROFILE } from "./queue-alarm-profiles.js";
import { buildQueueResult, type QueueBuilderResult } from "./build-queue.js";
import {
  throwIfRedriveTargetFifoMismatch,
  validateFifoQueueProps,
  warnIfLowMaxReceiveCount,
} from "./queue-validation.js";

/**
 * Configuration properties for the FIFO SQS queue builder.
 *
 * Extends the CDK {@link QueueProps} with builder-specific options, with
 * two FIFO-aware adjustments:
 *
 * - `fifo` is not settable — the builder always creates a FIFO queue.
 * - `queueName` is typed as {@link FifoQueueName}, so a name missing the
 *   AWS-required `.fifo` suffix is a compile error rather than a synth
 *   failure.
 */
export interface FifoQueueBuilderProps
  extends Omit<QueueProps, "fifo" | "queueName">, QueueBuilderExtensionProps {
  /**
   * Physical name of the FIFO queue. Must end in `.fifo` (AWS
   * requirement, enforced by the type and validated at build for
   * untyped callers). Omit to let CloudFormation generate a valid name.
   */
  queueName?: FifoQueueName;
}

/**
 * A fluent builder for configuring and creating an AWS SQS FIFO queue.
 *
 * Mirrors {@link createQueueBuilder | the standard queue builder} —
 * same secure defaults, same recommended alarms, same `Lifecycle`
 * composition — with FIFO-specific behaviour:
 *
 * - `fifo: true` is always applied; it is not settable.
 * - `queueName` must end in `.fifo` (compile-time via
 *   {@link FifoQueueName}, build-time for untyped callers).
 * - High-throughput mode (`fifoThroughputLimit: PER_MESSAGE_GROUP_ID`)
 *   without `deduplicationScope: MESSAGE_GROUP` throws at build.
 * - A non-FIFO `deadLetterQueue` target throws at build — AWS requires
 *   a FIFO queue's DLQ to be FIFO (see {@link createDlqQueueBuilder}).
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html
 *
 * @example
 * ```ts
 * const orderEvents = createFifoQueueBuilder()
 *   .queueName("order-events.fifo")
 *   .contentBasedDeduplication(true);
 * ```
 */
export type IFifoQueueBuilder = ITaggedBuilder<FifoQueueBuilderProps, FifoQueueBuilder>;

class FifoQueueBuilder implements Lifecycle<QueueBuilderResult> {
  props: Partial<FifoQueueBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IQueue>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IQueue>) => AlarmDefinitionBuilder<IQueue>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: FifoQueueBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): QueueBuilderResult {
    const mergedProps = { ...QUEUE_DEFAULTS, ...this.props, fifo: true };

    validateFifoQueueProps("FifoQueueBuilder", id, mergedProps);
    throwIfRedriveTargetFifoMismatch("FifoQueueBuilder", id, true, mergedProps.deadLetterQueue);
    warnIfLowMaxReceiveCount(scope, "FifoQueueBuilder", id, mergedProps);

    return buildQueueResult(scope, id, mergedProps, this.#customAlarms, PRIMARY_ALARM_PROFILE);
  }
}

/**
 * Creates a new {@link IFifoQueueBuilder} for configuring an AWS SQS FIFO
 * queue.
 *
 * The returned builder exposes every {@link FifoQueueBuilderProps}
 * property as a fluent setter/getter and implements {@link Lifecycle}
 * for use with {@link compose}. The queue is always FIFO — for a
 * standard queue use {@link createQueueBuilder}; for a dead-letter
 * queue (FIFO or standard) use {@link createDlqQueueBuilder}.
 *
 * @returns A fluent builder for an AWS SQS FIFO queue.
 *
 * @example
 * ```ts
 * // High-throughput FIFO — the dedup scope is required and validated.
 * const orderEvents = createFifoQueueBuilder()
 *   .queueName("order-events.fifo")
 *   .fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID)
 *   .deduplicationScope(DeduplicationScope.MESSAGE_GROUP);
 * ```
 */
export function createFifoQueueBuilder(): IFifoQueueBuilder {
  return taggedBuilder<FifoQueueBuilderProps, FifoQueueBuilder>(FifoQueueBuilder);
}
