import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Lambda, type LambdaProps } from "aws-cdk-lib/aws-ses-actions";
import { combine, type Ref, type Resolvable } from "@composurecdk/core";

/**
 * Options for {@link lambdaAction} — every CDK {@link LambdaProps} field
 * except `function`, which is the helper's positional argument.
 *
 * `topic` reads its inner type from CDK's own prop rather than naming
 * `ITopic`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export interface LambdaActionOptions extends Omit<LambdaProps, "function" | "topic"> {
  /** SNS topic notified when the function is invoked. */
  readonly topic?: Resolvable<NonNullable<LambdaProps["topic"]>>;
}

/**
 * Invokes a Lambda function for the received mail. The function and the
 * notification topic each accept a {@link Resolvable}, so they can wire to
 * sibling components via `ref()`.
 *
 * `fn` reads its inner type from CDK's own prop rather than naming
 * `IFunction`, so it keeps tracking the installed `aws-cdk-lib` (ADR-0018).
 */
export function lambdaAction(
  fn: Resolvable<LambdaProps["function"]>,
  options: LambdaActionOptions = {},
): Ref<IReceiptRuleAction> {
  const { invocationType, topic } = options;
  return combine(
    { fn, topic },
    (resolved): IReceiptRuleAction =>
      new Lambda({
        function: resolved.fn,
        ...(invocationType !== undefined && { invocationType }),
        ...(resolved.topic && { topic: resolved.topic }),
      }),
  );
}
