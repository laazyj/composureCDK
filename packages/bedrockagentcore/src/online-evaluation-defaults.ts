import {
  ExecutionStatus,
  type OnlineEvaluationConfigProps,
} from "aws-cdk-lib/aws-bedrockagentcore";

/**
 * Defaults applied to every online evaluation built with
 * {@link createOnlineEvaluationBuilder}. Each can be overridden through the
 * builder.
 */
export const ONLINE_EVALUATION_DEFAULTS: Partial<OnlineEvaluationConfigProps> = {
  /**
   * Evaluate traces once deployed. CDK leaves it unset; the service then
   * defaults to disabled.
   */
  executionStatus: ExecutionStatus.ENABLED,
};
