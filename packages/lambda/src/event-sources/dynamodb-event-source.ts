import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IEventSource } from "aws-cdk-lib/aws-lambda";
import { MetricType, StartingPosition } from "aws-cdk-lib/aws-lambda";
import {
  DynamoEventSource,
  type DynamoEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { isRef, type Resolvable } from "@composurecdk/core";
import { type ComposureEventSource, composureEventSource } from "./composure-event-source.js";

/**
 * Secure, AWS-recommended defaults applied to every DynamoDB stream event
 * source built with {@link dynamoEventSource}. Each property can be overridden
 * via the factory's `props` argument.
 */
export const DEFAULT_DYNAMO_EVENT_SOURCE_PROPS: Pick<
  DynamoEventSourceProps,
  "startingPosition" | "reportBatchItemFailures" | "metricsConfig"
> = {
  /**
   * Start reading from the tip of the stream so a newly-attached consumer does
   * not replay the table's existing change history on first deploy. Override
   * with {@link StartingPosition.TRIM_HORIZON} to reprocess from the oldest
   * record in the stream.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html
   */
  startingPosition: StartingPosition.LATEST,

  /**
   * Report partial batch failures so a single poison record does not fail the
   * whole batch and force redelivery of already-processed records. CDK
   * defaults this to `false`.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-batchfailurereporting
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
 * Wraps a DynamoDB table's change stream as a Lambda {@link IEventSource},
 * deferring resolution when the table is a `ref()` to a sibling component's
 * output.
 *
 * Follows the `events/targets` factory shape: register the result with
 * {@link IFunctionBuilder.addEventSource} and the builder resolves the
 * `ref()`, attaches the source, and (because `addEventSource` calls
 * `source.bind(fn)`) grants the function's least-privilege execution role
 * permission to read the stream via `grantStreamRead`.
 *
 * Applies {@link DEFAULT_DYNAMO_EVENT_SOURCE_PROPS}; pass `props` to override.
 *
 * ## Cross-component invariant (enforced by CDK at bind time)
 *
 * The table must have a stream enabled (via the table builder's
 * `.dynamoStream(...)` / `.stream(...)`, or `TableProps.stream`). If it does
 * not, CDK's `DynamoEventSource.bind()` throws `DynamoDB Streams must be
 * enabled on the table` when the function is built — the table often arrives
 * as a `ref()` that is not resolvable at configuration time, so this is not
 * validated earlier.
 *
 * @param table - The source table, concrete or a `ref()` to a sibling.
 * @param props - Overrides for {@link DEFAULT_DYNAMO_EVENT_SOURCE_PROPS} and
 *   any other {@link DynamoEventSourceProps}.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     orders: createTableV2Builder()
 *       .partitionKey({ name: "pk", type: AttributeType.STRING })
 *       .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES),
 *     processor: createFunctionBuilder()
 *       .runtime(Runtime.NODEJS_22_X)
 *       .handler("index.handler")
 *       .code(Code.fromAsset("lambda"))
 *       .addEventSource("orders", dynamoEventSource(ref("orders", (r) => r.table))),
 *   },
 *   { orders: [], processor: ["orders"] },
 * );
 * ```
 */
export function dynamoEventSource(
  table: Resolvable<ITable>,
  props?: DynamoEventSourceProps,
): ComposureEventSource {
  const merged: DynamoEventSourceProps = { ...DEFAULT_DYNAMO_EVENT_SOURCE_PROPS, ...props };
  const source: Resolvable<IEventSource> = isRef(table)
    ? table.map((resolved) => new DynamoEventSource(resolved, merged))
    : new DynamoEventSource(table, merged);
  return composureEventSource("dynamodb", source);
}
