import { MetricType, StartingPosition } from "aws-cdk-lib/aws-lambda";
import type { StreamEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";

/**
 * Secure, AWS-recommended defaults shared by every polling **stream** event
 * source — DynamoDB Streams today, Kinesis when that source lands. Each field
 * lives on {@link StreamEventSourceProps} (the common base of
 * `DynamoEventSourceProps` and `KinesisEventSourceProps`), so a per-source
 * factory spreads this constant and adds only its source-specific overrides.
 *
 * Every property is individually overridable through the factory's `props`
 * argument — there is no opt-out flag, so any deviation is intentional and
 * visible (see docs/architecture.md, "Defaults").
 */
export const DEFAULT_STREAM_EVENT_SOURCE_PROPS: Pick<
  StreamEventSourceProps,
  "startingPosition" | "reportBatchItemFailures" | "bisectBatchOnError" | "metricsConfig"
> = {
  /**
   * Start reading from the tip of the stream so a newly-attached consumer does
   * not replay the source's existing change history on first deploy. Override
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
   * Split a failing batch in two and retry each half, isolating a single poison
   * record instead of letting it block the whole shard until the stream's
   * retention window expires. CDK defaults this to `false`. Reliability pillar.
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-batchfailurereporting
   * @see https://aws.amazon.com/about-aws/whats-new/2019/11/aws-lambda-supports-failure-handling-features-for-kinesis-and-dynamodb-event-sources/
   */
  bisectBatchOnError: true,

  /**
   * Enable the per-mapping `EventCount` ESM metrics (`FailedInvokeEventCount`,
   * `DroppedEventCount`, …). They emit only when opted in, and the
   * event-source contextual alarms on {@link IFunctionBuilder} depend on them.
   * @see https://aws.amazon.com/blogs/compute/introducing-new-event-source-mapping-esm-metrics-for-aws-lambda/
   */
  metricsConfig: { metrics: [MetricType.EVENT_COUNT] },
};
