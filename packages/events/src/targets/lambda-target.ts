import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { LambdaFunction, type LambdaFunctionProps } from "aws-cdk-lib/aws-events-targets";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps a Lambda function as an EventBridge {@link IRuleTarget}, deferring
 * resolution if the function is a {@link Ref} to a sibling component's
 * output.
 *
 * Mirrors the {@link LambdaFunction} target from `aws-events-targets` —
 * `props` accepts the same options ({@link LambdaFunctionProps.event} for
 * input transformation, plus `deadLetterQueue`, `maxEventAge`,
 * `retryAttempts` from {@link LambdaFunctionProps}'s base).
 *
 * Cross-component DLQ wiring (where the queue is built by another component)
 * is supported by composing through `ref().map()` instead of passing the
 * queue here directly:
 *
 * ```ts
 * .addTarget(
 *   "stopper",
 *   ref<StopperBundle>("stopperBundle", b =>
 *     lambdaTarget(b.fn, { deadLetterQueue: b.dlq }),
 *   ),
 * )
 * ```
 *
 * @see https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html
 */
export function lambdaTarget(
  fn: Resolvable<IFunction>,
  props?: LambdaFunctionProps,
): Resolvable<IRuleTarget> {
  if (isRef(fn)) return fn.map((resolved) => new LambdaFunction(resolved, props));
  return new LambdaFunction(fn, props);
}
