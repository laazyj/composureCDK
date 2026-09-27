import { GatewayAuthorizer, type GatewayProps } from "aws-cdk-lib/aws-bedrockagentcore";

/**
 * Defaults applied to every gateway built with {@link createGatewayBuilder}.
 * Each can be overridden through the builder.
 */
export const GATEWAY_DEFAULTS: Partial<GatewayProps> = {
  /**
   * Require SigV4-signed requests. Inbound authorization is Security Hub
   * control BedrockAgentCore.2; IAM meets it without the Cognito user pool
   * CDK otherwise creates.
   * @see https://docs.aws.amazon.com/securityhub/latest/userguide/bedrockagentcore-controls.html#bedrockagentcore-2
   */
  authorizerConfiguration: GatewayAuthorizer.usingAwsIam(),
};
