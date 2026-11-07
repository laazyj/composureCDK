import type { IEventSource } from "aws-cdk-lib/aws-lambda";
import { SqsDlq, type StreamEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { combine, isRef, type Resolvable } from "@composurecdk/core";
import {
  type ComposureEventSource,
  composureEventSource,
  type EventSourceKind,
} from "./composure-event-source.js";
import { DEFAULT_STREAM_EVENT_SOURCE_PROPS } from "./stream-event-source-defaults.js";

/** CDK's failure-destination type for a polling stream source, read off its own prop (ADR-0018). */
type StreamFailureDestination = NonNullable<StreamEventSourceProps["onFailure"]>;

/** Wraps a raw queue in an {@link SqsDlq}; passes an existing destination through. */
function toDlq(destination: IQueue | StreamFailureDestination): StreamFailureDestination {
  // Duck-type the queue rather than `instanceof` — the ESM and CommonJS copies
  // of a package can both load in one process (ADR-0007).
  return "queueArn" in destination ? new SqsDlq(destination) : destination;
}

/** The props every stream factory accepts: CDK's own, with `onFailure` widened. */
interface WidenedStreamProps {
  onFailure?: Resolvable<IQueue | StreamFailureDestination>;
}

/** A factory's props once the defaults are applied and `onFailure` is resolved. */
type ResolvedStreamProps<P extends WidenedStreamProps> = Omit<P, "onFailure"> &
  typeof DEFAULT_STREAM_EVENT_SOURCE_PROPS & { onFailure?: StreamFailureDestination };

/**
 * Assembles a polling-stream {@link ComposureEventSource} (DynamoDB, Kinesis)
 * from its upstream resource and the factory's props — the upstream and the
 * `onFailure` destination may each be a `ref()` to a sibling component.
 *
 * Layers `props` over {@link DEFAULT_STREAM_EVENT_SOURCE_PROPS}, then `create`
 * builds the CDK source from the resolved upstream and the merged props, whose
 * `onFailure` is resolved (a bare queue already wrapped in an {@link SqsDlq}).
 * With no destination only the upstream can be lazy, so the single-ref fast
 * path is kept; otherwise both are combined into one deferred value (ADR-0015).
 *
 * @internal
 */
export function streamEventSource<T, P extends WidenedStreamProps>(
  kind: EventSourceKind,
  upstream: Resolvable<T>,
  props: P | undefined,
  create: (resolved: T, props: ResolvedStreamProps<P>) => IEventSource,
): ComposureEventSource {
  const { onFailure, ...rest } = props ?? ({} as P);
  const merged = { ...DEFAULT_STREAM_EVENT_SOURCE_PROPS, ...rest } as ResolvedStreamProps<P>;

  let source: Resolvable<IEventSource>;
  if (onFailure === undefined) {
    source = isRef(upstream)
      ? upstream.map((resolved) => create(resolved, merged))
      : create(upstream, merged);
  } else {
    // `Resolved<T>` is a conditional type TypeScript cannot reduce for a generic
    // `T`; every caller passes a construct interface, never a nested `Ref`, so
    // the resolved upstream is `T`.
    source = combine({ upstream, onFailure }, (resolved) =>
      create(resolved.upstream as T, { ...merged, onFailure: toDlq(resolved.onFailure) }),
    );
  }
  return composureEventSource(kind, source);
}
