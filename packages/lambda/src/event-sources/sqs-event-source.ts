import type { IEventSource } from "aws-cdk-lib/aws-lambda";
import { MetricType } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource, type SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { isRef, type Resolvable } from "@composurecdk/core";
import { type ComposureEventSource, composureEventSource } from "./composure-event-source.js";

/**
 * Secure, AWS-recommended defaults applied to every SQS event source built
 * with {@link sqsEventSource}. Each property can be overridden via the
 * factory's `props` argument.
 */
export const DEFAULT_SQS_EVENT_SOURCE_PROPS: Pick<
  SqsEventSourceProps,
  "reportBatchItemFailures" | "metricsConfig"
> = {
  /**
   * Report partial batch failures so a single poison message does not fail
   * the whole batch and force redelivery of already-processed records. CDK
   * defaults this to `false`.
   * @see https://aws.amazon.com/blogs/compute/implementing-aws-well-architected-best-practices-for-amazon-sqs-part-3/
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting
   */
  reportBatchItemFailures: true,

  /**
   * Enable the per-mapping `EventCount` ESM metrics (`FailedInvokeEventCount`,
   * `DroppedEventCount`, …). They emit only when opted in, and the
   * event-source contextual alarms on {@link IFunctionBuilder} depend on them.
   * @see https://aws.amazon.com/blogs/compute/introducing-new-event-source-mapping-esm-metrics-for-aws-lambda/
   */
  metricsConfig: { metrics: [MetricType.EVENT_COUNT] },
};

/**
 * Wraps an SQS queue as a Lambda {@link IEventSource}, deferring resolution
 * when the queue is a `ref()` to a sibling component's output.
 *
 * Follows the `events/targets` factory shape: register the result with
 * {@link IFunctionBuilder.addEventSource} and the builder resolves the
 * `ref()`, attaches the source, and (because `addEventSource` calls
 * `source.bind(fn)`) grants the function's least-privilege execution role
 * permission to consume the queue.
 *
 * Applies {@link DEFAULT_SQS_EVENT_SOURCE_PROPS}; pass `props` to override.
 *
 * ## Cross-component invariants
 *
 * AWS Well-Architected guidance spans the queue and the function:
 * - the source queue's visibility timeout should be ≥ 6× the function
 *   timeout, leaving room for Lambda to retry a throttled batch;
 * - the source queue's redrive `maxReceiveCount` should be ≥ 5 before the DLQ.
 *
 * The visibility-timeout rule is enforced as a synth-time **relationship
 * guard**: when this source is attached to a {@link IFunctionBuilder}, the
 * builder reads the queue's resolved `visibilityTimeout` off its L1 `CfnQueue`
 * (the `Queue` construct does not re-expose it) and warns, suppressibly, on an
 * actual violation — see ADR-0011. The `maxReceiveCount` floor is tracked in
 * laazyj/composureCDK#124.
 *
 * @param queue - The source queue, concrete or a `ref()` to a sibling.
 * @param props - Overrides for {@link DEFAULT_SQS_EVENT_SOURCE_PROPS} and any
 *   other {@link SqsEventSourceProps}.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     orders: createQueueBuilder().queueName("orders"),
 *     processor: createFunctionBuilder()
 *       .runtime(Runtime.NODEJS_22_X)
 *       .handler("index.handler")
 *       .code(Code.fromAsset("lambda"))
 *       .addEventSource("orders", sqsEventSource(ref("orders", (r) => r.queue))),
 *   },
 *   { orders: [], processor: ["orders"] },
 * );
 * ```
 */
export function sqsEventSource(
  queue: Resolvable<IQueue>,
  props?: SqsEventSourceProps,
): ComposureEventSource {
  const merged: SqsEventSourceProps = { ...DEFAULT_SQS_EVENT_SOURCE_PROPS, ...props };
  const source: Resolvable<IEventSource> = isRef(queue)
    ? queue.map((resolved) => new SqsEventSource(resolved, merged))
    : new SqsEventSource(queue, merged);
  return composureEventSource("sqs", source);
}
