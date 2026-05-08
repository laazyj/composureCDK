import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { SfnStateMachine, type SfnStateMachineProps } from "aws-cdk-lib/aws-events-targets";
import type { IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
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
 */
export function sfnStateMachineTarget(
  stateMachine: Resolvable<IStateMachine>,
  props?: SfnStateMachineProps,
): Resolvable<IRuleTarget> {
  if (isRef(stateMachine)) {
    return stateMachine.map((resolved) => new SfnStateMachine(resolved, props));
  }
  return new SfnStateMachine(stateMachine, props);
}
