import type { IEventBus, IRuleTarget } from "aws-cdk-lib/aws-events";
import { EventBus as EventBusTarget, type EventBusProps } from "aws-cdk-lib/aws-events-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps an EventBridge bus as an {@link IRuleTarget}, deferring resolution
 * if the bus is a {@link Ref} to a sibling component's output.
 *
 * Mirrors the {@link EventBusTarget} target from `aws-events-targets` —
 * useful for cross-bus or cross-account routing. `props` accepts
 * {@link EventBusProps.role} (otherwise CDK creates one) and a per-target
 * `deadLetterQueue`. Note: bus targets do **not** support retry policy
 * configuration, per CDK's {@link EventBusProps} (it intentionally does not
 * extend the retry base).
 */
export function eventBusTarget(
  bus: Resolvable<IEventBus>,
  props?: EventBusProps,
): Resolvable<IRuleTarget> {
  if (isRef(bus)) return bus.map((resolved) => new EventBusTarget(resolved, props));
  return new EventBusTarget(bus, props);
}
