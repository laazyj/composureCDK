import type { IQueue, QueueProps } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { FifoOnlyPropKey, QueueBuilderExtensionProps } from "./queue-props.js";
import { QUEUE_DEFAULTS } from "./defaults.js";
import { PRIMARY_ALARM_PROFILE } from "./queue-alarm-profiles.js";
import { buildQueueResult, type QueueBuilderResult } from "./build-queue.js";
import {
  throwIfFifoPropsOnStandardQueue,
  throwIfRedriveTargetFifoMismatch,
  warnIfLowMaxReceiveCount,
} from "./queue-validation.js";

/**
 * Configuration properties for the standard SQS queue builder.
 *
 * Extends the CDK {@link QueueProps} with additional builder-specific
 * options, minus the FIFO-only properties (`fifo`,
 * `contentBasedDeduplication`, `deduplicationScope`,
 * `fifoThroughputLimit`) — FIFO queues have their own entry point,
 * {@link createFifoQueueBuilder}, with FIFO-aware validation.
 */
export interface QueueBuilderProps
  extends Omit<QueueProps, FifoOnlyPropKey>, QueueBuilderExtensionProps {}

/**
 * A fluent builder for configuring and creating a standard AWS SQS queue.
 *
 * Each configuration property from {@link QueueBuilderProps} is exposed
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
 * Custom alarms can be added via the `addAlarm` method.
 *
 * For the other queue types, use the sibling builders:
 * - {@link createFifoQueueBuilder} — FIFO queues.
 * - {@link createDlqQueueBuilder} — dead-letter queues.
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
    const mergedProps = { ...QUEUE_DEFAULTS, ...this.props };

    throwIfFifoPropsOnStandardQueue(id, mergedProps);
    throwIfRedriveTargetFifoMismatch("QueueBuilder", id, false, mergedProps.deadLetterQueue);
    warnIfLowMaxReceiveCount(scope, "QueueBuilder", id, mergedProps);

    return buildQueueResult(scope, id, mergedProps, this.#customAlarms, PRIMARY_ALARM_PROFILE);
  }
}

/**
 * Creates a new {@link IQueueBuilder} for configuring a standard AWS SQS
 * queue.
 *
 * This is the entry point for defining a standard SQS queue component. The
 * returned builder exposes every {@link QueueBuilderProps} property as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * FIFO queues and dead-letter queues have their own entry points with
 * type-specific defaults, alarms, and validation:
 * {@link createFifoQueueBuilder} and {@link createDlqQueueBuilder}.
 *
 * @returns A fluent builder for a standard AWS SQS queue.
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
