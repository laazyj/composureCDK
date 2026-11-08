import type { IStream, IStreamConsumer } from "aws-cdk-lib/aws-kinesis";
import type { StartingPosition } from "aws-cdk-lib/aws-lambda";
import {
  KinesisConsumerEventSource,
  KinesisEventSource,
  type KinesisEventSourceProps,
} from "aws-cdk-lib/aws-lambda-event-sources";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { Resolvable } from "@composurecdk/core";
import type { ComposureEventSource } from "./composure-event-source.js";
import { streamEventSource } from "./stream-event-source.js";
import { DEFAULT_STREAM_EVENT_SOURCE_PROPS } from "./stream-event-source-defaults.js";

/**
 * Secure, AWS-recommended defaults applied to every Kinesis event source built
 * with {@link kinesisEventSource} or {@link kinesisConsumerEventSource} — the
 * shared {@link DEFAULT_STREAM_EVENT_SOURCE_PROPS} (start at the stream tip,
 * report partial batch failures, bisect a failing batch, emit ESM metrics).
 * Each property can be overridden via the factory's `props` argument.
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html
 */
export const DEFAULT_KINESIS_EVENT_SOURCE_PROPS = DEFAULT_STREAM_EVENT_SOURCE_PROPS;

/**
 * Props for {@link kinesisEventSource} and {@link kinesisConsumerEventSource}.
 * Identical to CDK's {@link KinesisEventSourceProps} except that
 * `startingPosition` is optional and `onFailure` is widened to a
 * {@link Resolvable} that additionally accepts a bare {@link IQueue} (or a
 * `ref()` to one), wrapped in an `SqsDlq` for you — so a dead-letter queue
 * built by a sibling component wires up declaratively:
 * `onFailure: ref("dlq", (r) => r.queue)`.
 */
export interface KinesisStreamEventSourceProps extends Omit<
  KinesisEventSourceProps,
  "onFailure" | "startingPosition"
> {
  /**
   * Where to start reading the stream. Optional here — unlike CDK's
   * {@link KinesisEventSourceProps} — because
   * {@link DEFAULT_KINESIS_EVENT_SOURCE_PROPS} supplies
   * {@link StartingPosition.LATEST} when omitted. `AT_TIMESTAMP` also needs
   * `startingPositionTimestamp`.
   */
  startingPosition?: StartingPosition;

  /**
   * Destination for records that exhaust `retryAttempts` or exceed
   * `maxRecordAge`. Pass an {@link IQueue} (wrapped in an `SqsDlq`
   * automatically), a concrete destination, or a `ref()` to a sibling that
   * produces either.
   *
   * The destination arm is read from CDK's own prop rather than named as
   * `IEventSourceDlq`, so it keeps tracking that type as CDK moves it
   * (ADR-0018). The `IQueue` arm is the builder's own convenience and has no
   * CDK prop to read from.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/kinesis-on-failure-destination.html
   */
  onFailure?: Resolvable<IQueue | NonNullable<KinesisEventSourceProps["onFailure"]>>;
}

/**
 * Wraps a Kinesis data stream as a Lambda {@link IEventSource} using
 * **shared-throughput** (standard) iterators, deferring resolution when the
 * stream (or the `onFailure` destination) is a `ref()` to a sibling
 * component's output.
 *
 * Register the result with {@link IFunctionBuilder.addEventSource}: the
 * builder resolves the `ref()`, attaches the source, and (because
 * `addEventSource` calls `source.bind(fn)`) grants the function's
 * least-privilege execution role permission to read the stream — including
 * `kms:Decrypt` when the stream is encrypted with a customer-managed key.
 *
 * Applies {@link DEFAULT_KINESIS_EVENT_SOURCE_PROPS}; pass `props` to override.
 * For a dedicated 2 MB/s-per-shard read pipe instead of sharing the shard's
 * read throughput with other consumers, use {@link kinesisConsumerEventSource}.
 *
 * ## Failure handling (AWS Well-Architected)
 *
 * By default Lambda retries a failing batch until its records expire from the
 * stream, blocking the shard for up to the stream's retention period (24 h by
 * CDK's default, 7 days with `@composurecdk/kinesis`). `bisectBatchOnError` is
 * on by default to isolate a poison record; for durable failure handling also
 * bound `retryAttempts` / `maxRecordAge` **and** set `onFailure` so exhausted
 * records land in a dead-letter destination instead of being dropped —
 * bounding retries without one triggers a suppressible synth-time warning (see
 * {@link STREAM_DLQ_WARNING_ID}).
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html
 * @see https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html
 *
 * @param stream - The source stream, concrete or a `ref()` to a sibling.
 * @param props - Overrides for {@link DEFAULT_KINESIS_EVENT_SOURCE_PROPS} and
 *   any other {@link KinesisStreamEventSourceProps}.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     telemetry: createStreamBuilder(),
 *     dlq: createQueueBuilder("dlq"),
 *     processor: createFunctionBuilder()
 *       .runtime(Runtime.NODEJS_22_X)
 *       .handler("index.handler")
 *       .code(Code.fromAsset("lambda"))
 *       .addEventSource(
 *         "telemetry",
 *         kinesisEventSource(ref("telemetry", (r) => r.stream), {
 *           retryAttempts: 3,
 *           onFailure: ref("dlq", (r) => r.queue),
 *         }),
 *       ),
 *   },
 *   { telemetry: [], dlq: [], processor: ["telemetry", "dlq"] },
 * );
 * ```
 */
export function kinesisEventSource(
  stream: Resolvable<IStream>,
  props?: KinesisStreamEventSourceProps,
): ComposureEventSource {
  return streamEventSource(
    "kinesis",
    stream,
    props,
    (resolved, merged) => new KinesisEventSource(resolved, merged),
  );
}

/**
 * Wraps a Kinesis **enhanced fan-out** consumer as a Lambda
 * {@link IEventSource}. Same defaults, `onFailure` handling and `ref()`
 * resolution as {@link kinesisEventSource}; the function reads through the
 * registered consumer, which gets its own 2 MB/s per shard of read
 * throughput pushed over HTTP/2 rather than sharing the shard's 2 MB/s with
 * every other polling consumer.
 *
 * Use it when several applications read the same stream, or when the
 * function needs the lowest propagation delay; enhanced fan-out is billed
 * per consumer-shard-hour and per GB retrieved, so a single consumer is
 * usually cheaper on shared throughput.
 *
 * @see https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html
 * @see https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html
 *
 * @param consumer - The registered stream consumer, concrete or a `ref()` to
 *   a sibling.
 * @param props - Overrides for {@link DEFAULT_KINESIS_EVENT_SOURCE_PROPS} and
 *   any other {@link KinesisStreamEventSourceProps}.
 */
export function kinesisConsumerEventSource(
  consumer: Resolvable<IStreamConsumer>,
  props?: KinesisStreamEventSourceProps,
): ComposureEventSource {
  return streamEventSource(
    "kinesis",
    consumer,
    props,
    (resolved, merged) => new KinesisConsumerEventSource(resolved, merged),
  );
}
