import type { IEventSource } from "aws-cdk-lib/aws-lambda";
import type { DynamoEventSource, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import type { Resolvable } from "@composurecdk/core";

/**
 * Discriminator for the kind of event source a {@link ComposureEventSource}
 * wraps. `FunctionBuilder` keys its contextual alarms and invariant checks
 * off this value so it never has to `instanceof` CDK internals.
 *
 * `"unknown"` is the kind assigned to a bare {@link IEventSource} passed
 * straight to {@link IFunctionBuilder.addEventSource} as an escape hatch —
 * the builder still attaches it, but cannot reason about it.
 */
export type EventSourceKind = "sqs" | "dynamodb" | "unknown";

/** @internal — brands {@link ComposureEventSource} so the guard is unambiguous. */
const COMPOSURE_EVENT_SOURCE = Symbol.for("composurecdk.lambda.eventSource");

/**
 * A `Resolvable`-aware event source produced by a ComposureCDK factory
 * (e.g. {@link sqsEventSource}).
 *
 * Follows the `events/targets` factory shape — the factory wraps the
 * underlying CDK event source and resolves any `ref()` to a sibling
 * component at build time — and additionally tags it with a
 * {@link EventSourceKind} discriminator so `FunctionBuilder` can pick the
 * right contextual alarms without inspecting CDK internals.
 *
 * Construct one via a factory rather than by hand; the brand is private.
 */
export interface ComposureEventSource {
  /** @internal */
  readonly [COMPOSURE_EVENT_SOURCE]: true;

  /** The kind of source, used to dispatch contextual alarms and checks. */
  readonly kind: EventSourceKind;

  /**
   * The wrapped CDK event source, deferred behind a {@link Resolvable} when
   * the factory was handed a `ref()` to a sibling component's output.
   */
  readonly source: Resolvable<IEventSource>;
}

/** @internal — assembles a branded {@link ComposureEventSource}. */
export function composureEventSource(
  kind: EventSourceKind,
  source: Resolvable<IEventSource>,
): ComposureEventSource {
  return { [COMPOSURE_EVENT_SOURCE]: true, kind, source };
}

/**
 * Reads the event source mapping UUID off a bound CDK source, keyed by
 * {@link EventSourceKind}. Defined only for kinds whose per-mapping ESM
 * metrics back contextual alarms (SQS and DynamoDB streams); `FunctionBuilder`
 * invokes the reader after `addEventSource` so the binding exists. Keying off
 * `kind` — like {@link EVENT_SOURCE_ALARM_SPECS} — keeps the builder from
 * `instanceof`-ing CDK source classes.
 *
 * @internal
 */
export const EVENT_SOURCE_MAPPING_ID_READERS: Record<
  EventSourceKind,
  ((bound: IEventSource) => string) | undefined
> = {
  // Safe: the `"sqs"` kind is only ever assigned by `sqsEventSource()`, which
  // constructs the `SqsEventSource` in the same call — kind and concrete class
  // move in lockstep.
  sqs: (bound) => (bound as SqsEventSource).eventSourceMappingId,
  // Safe: the `"dynamodb"` kind is only ever assigned by `dynamoEventSource()`,
  // which constructs the `DynamoEventSource` in the same call — kind and
  // concrete class move in lockstep.
  dynamodb: (bound) => (bound as DynamoEventSource).eventSourceMappingId,
  unknown: undefined,
};

/**
 * Type guard distinguishing a {@link ComposureEventSource} from a bare
 * {@link IEventSource} escape-hatch value.
 */
export function isComposureEventSource(
  value: ComposureEventSource | IEventSource,
): value is ComposureEventSource {
  return COMPOSURE_EVENT_SOURCE in value;
}

/**
 * An event source resolved and attached to a function during build, carrying
 * the metadata the alarm machinery needs to emit contextual alarms.
 *
 * @internal — the contract between `FunctionBuilder.build()` and the
 *   event-source alarm machinery in `function-alarms.ts`.
 */
export interface AttachedEventSource {
  /** The key the source was registered under via `addEventSource`. */
  key: string;

  /** The kind of source, used to dispatch contextual alarms. */
  kind: EventSourceKind;

  /**
   * The event source mapping UUID, populated for kinds whose per-mapping
   * ESM metrics back contextual alarms (currently SQS only). The contextual
   * alarms key off this dimension.
   */
  eventSourceMappingId?: string;
}
