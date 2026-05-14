import type { IEventSource } from "aws-cdk-lib/aws-lambda";
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
export type EventSourceKind = "sqs" | "unknown";

/** @internal — brands {@link ComposureEventSource} so the guard is unambiguous. */
const COMPOSURE_EVENT_SOURCE = Symbol.for("composurecdk.lambda.eventSource");

/**
 * A `Resolvable`-aware event source produced by a ComposureCDK factory
 * (e.g. {@link sqsEventSource}).
 *
 * Follows the `events/targets` factory shape — the factory wraps the
 * underlying CDK event source and resolves any `ref()` to a sibling
 * component at build time — and additionally tags it with a
 * {@link EventSourceKind} discriminator (plus an optional mapping-id reader)
 * so `FunctionBuilder` can pick the right contextual alarms without
 * inspecting CDK internals.
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

  /**
   * Reads the event source mapping UUID off the source once it has been
   * bound to a function. Defined only for kinds whose per-mapping ESM
   * metrics back contextual alarms (currently SQS); the builder invokes it
   * after `addEventSource` so the binding exists. Keeping it here lets the
   * builder stay kind-agnostic — no `instanceof` of CDK source classes.
   */
  readonly readMappingId?: (bound: IEventSource) => string;
}

/** @internal — assembles a branded {@link ComposureEventSource}. */
export function composureEventSource(
  kind: EventSourceKind,
  source: Resolvable<IEventSource>,
  readMappingId?: (bound: IEventSource) => string,
): ComposureEventSource {
  return { [COMPOSURE_EVENT_SOURCE]: true, kind, source, readMappingId };
}

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
