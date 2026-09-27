import type { ITable } from "aws-cdk-lib/aws-dynamodb";
import type { IEventSource, StartingPosition } from "aws-cdk-lib/aws-lambda";
import {
  DynamoEventSource,
  type DynamoEventSourceProps,
  SqsDlq,
} from "aws-cdk-lib/aws-lambda-event-sources";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { combine, isRef, type Resolvable } from "@composurecdk/core";
import { type ComposureEventSource, composureEventSource } from "./composure-event-source.js";
import { DEFAULT_STREAM_EVENT_SOURCE_PROPS } from "./stream-event-source-defaults.js";

/**
 * Secure, AWS-recommended defaults applied to every DynamoDB stream event
 * source built with {@link dynamoEventSource} — the shared
 * {@link DEFAULT_STREAM_EVENT_SOURCE_PROPS} (start at the stream tip, report
 * partial batch failures, bisect a failing batch, emit ESM metrics). Each
 * property can be overridden via the factory's `props` argument.
 */
export const DEFAULT_DYNAMO_EVENT_SOURCE_PROPS = DEFAULT_STREAM_EVENT_SOURCE_PROPS;

/**
 * Props for {@link dynamoEventSource}. Identical to CDK's
 * {@link DynamoEventSourceProps} except that `onFailure` is widened to a
 * {@link Resolvable}, and additionally accepts a bare {@link IQueue} (or a
 * `ref()` to one) that is wrapped in an {@link SqsDlq} for you — so a
 * dead-letter queue built by a sibling component wires up declaratively:
 * `onFailure: ref("dlq", (r) => r.queue)`.
 */
export interface DynamoStreamEventSourceProps extends Omit<
  DynamoEventSourceProps,
  "onFailure" | "startingPosition"
> {
  /**
   * Where to start reading the stream. Optional here — unlike CDK's
   * {@link DynamoEventSourceProps} — because {@link DEFAULT_DYNAMO_EVENT_SOURCE_PROPS}
   * supplies {@link StartingPosition.LATEST} when omitted.
   */
  startingPosition?: StartingPosition;

  /**
   * Destination for records that exhaust `retryAttempts` or exceed
   * `maxRecordAge`. Pass an {@link IQueue} (wrapped in {@link SqsDlq}
   * automatically), a concrete destination, or a `ref()` to a sibling that
   * produces either.
   *
   * The destination arm is read from CDK's own prop rather than named as
   * `IEventSourceDlq`, so it keeps tracking that type as CDK moves it
   * (ADR-0018). The `IQueue` arm is the builder's own convenience and has no
   * CDK prop to read from.
   *
   * @see https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html#services-ddb-errors
   */
  onFailure?: Resolvable<IQueue | NonNullable<DynamoEventSourceProps["onFailure"]>>;
}

/** Wraps a raw queue in an {@link SqsDlq}; passes an existing destination through. */
function toDlq(
  destination: IQueue | NonNullable<DynamoEventSourceProps["onFailure"]>,
): NonNullable<DynamoEventSourceProps["onFailure"]> {
  // Duck-type the queue rather than `instanceof` — the ESM and CommonJS copies
  // of a package can both load in one process (ADR-0007).
  return "queueArn" in destination ? new SqsDlq(destination) : destination;
}

/**
 * Wraps a DynamoDB table's change stream as a Lambda {@link IEventSource},
 * deferring resolution when the table (or the `onFailure` DLQ) is a `ref()` to
 * a sibling component's output.
 *
 * Follows the `events/targets` factory shape: register the result with
 * {@link IFunctionBuilder.addEventSource} and the builder resolves the
 * `ref()`, attaches the source, and (because `addEventSource` calls
 * `source.bind(fn)`) grants the function's least-privilege execution role
 * permission to read the stream via `grantStreamRead`.
 *
 * Applies {@link DEFAULT_DYNAMO_EVENT_SOURCE_PROPS}; pass `props` to override.
 *
 * ## Failure handling (AWS Well-Architected)
 *
 * `bisectBatchOnError` is on by default so a single poison record cannot block
 * a shard for the whole 24 h stream-retention window. For durable failure
 * handling, also bound `retryAttempts` / `maxRecordAge` **and** set `onFailure`
 * so exhausted records land in a dead-letter queue instead of being dropped —
 * bounding retries without an `onFailure` destination triggers a suppressible
 * synth-time warning (see {@link STREAM_DLQ_WARNING_ID}).
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
 *   any other {@link DynamoStreamEventSourceProps}.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     orders: createTableV2Builder()
 *       .partitionKey({ name: "pk", type: AttributeType.STRING })
 *       .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES),
 *     dlq: createQueueBuilder("dlq"),
 *     processor: createFunctionBuilder()
 *       .runtime(Runtime.NODEJS_22_X)
 *       .handler("index.handler")
 *       .code(Code.fromAsset("lambda"))
 *       .addEventSource(
 *         "orders",
 *         dynamoEventSource(ref("orders", (r) => r.table), {
 *           retryAttempts: 3,
 *           onFailure: ref("dlq", (r) => r.queue),
 *         }),
 *       ),
 *   },
 *   { orders: [], dlq: [], processor: ["orders", "dlq"] },
 * );
 * ```
 */
export function dynamoEventSource(
  table: Resolvable<ITable>,
  props?: DynamoStreamEventSourceProps,
): ComposureEventSource {
  const { onFailure, ...rest } = props ?? {};
  const merged: Omit<DynamoEventSourceProps, "onFailure"> = {
    ...DEFAULT_DYNAMO_EVENT_SOURCE_PROPS,
    ...rest,
  };

  let source: Resolvable<IEventSource>;
  if (onFailure === undefined) {
    // No DLQ: only the table can be lazy — preserve the single-ref fast path.
    source = isRef(table)
      ? table.map((resolved) => new DynamoEventSource(resolved, merged))
      : new DynamoEventSource(table, merged);
  } else {
    // Table and DLQ are two siblings feeding one source — combine both refs
    // (either may be concrete) into a single deferred value (ADR-0015).
    source = combine(
      { table, onFailure },
      ({ table: resolvedTable, onFailure: resolvedDlq }) =>
        new DynamoEventSource(resolvedTable, { ...merged, onFailure: toDlq(resolvedDlq) }),
    );
  }

  return composureEventSource("dynamodb", source);
}
