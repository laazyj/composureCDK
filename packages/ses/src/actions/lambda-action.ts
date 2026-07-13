import { type IFunction } from "aws-cdk-lib/aws-lambda";
import { type IReceiptRuleAction } from "aws-cdk-lib/aws-ses";
import { Lambda, type LambdaInvocationType } from "aws-cdk-lib/aws-ses-actions";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { combine, type Ref, type Resolvable } from "@composurecdk/core";

/** Options for {@link lambdaAction}. */
export interface LambdaActionOptions {
  /**
   * Whether SES invokes the function asynchronously (`Event`) or waits for the
   * response (`RequestResponse`). Defaults to CDK's default, `Event`.
   */
  readonly invocationType?: LambdaInvocationType;
  /** SNS topic notified when the function is invoked. */
  readonly topic?: Resolvable<ITopic>;
}

/**
 * Invokes a Lambda function for the received mail. The function and the
 * notification topic each accept a {@link Resolvable}, so they can wire to
 * sibling components via `ref()`.
 */
export function lambdaAction(
  fn: Resolvable<IFunction>,
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
