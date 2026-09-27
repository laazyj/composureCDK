import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { SfnStateMachine, type SfnStateMachineProps } from "aws-cdk-lib/aws-events-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps a Step Functions state machine as an EventBridge
 * {@link IRuleTarget}, deferring resolution if the state machine is a
 * {@link Ref} to a sibling component's output.
 *
 * Mirrors the {@link SfnStateMachine} target from `aws-events-targets` —
 * `props` accepts {@link SfnStateMachineProps.input} for input
 * transformation, an explicit `role` (otherwise CDK creates one), plus the
 * inherited DLQ/retry options.
 *
 * `stateMachine` reads its type from CDK's own target constructor rather than
 * naming `IStateMachine`, so it keeps tracking the installed `aws-cdk-lib`
 * (ADR-0018).
 */
export function sfnStateMachineTarget(
  stateMachine: Resolvable<ConstructorParameters<typeof SfnStateMachine>[0]>,
  props?: SfnStateMachineProps,
): Resolvable<IRuleTarget> {
  if (isRef(stateMachine)) {
    return stateMachine.map((resolved) => new SfnStateMachine(resolved, props));
  }
  return new SfnStateMachine(stateMachine, props);
}
