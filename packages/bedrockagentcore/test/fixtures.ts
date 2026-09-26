import type { Stack } from "aws-cdk-lib";
import { type IBedrockAgentRuntime, Runtime } from "aws-cdk-lib/aws-bedrockagentcore";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export const RUNTIME_ARN =
  "arn:aws:bedrock-agentcore:eu-west-2:123456789012:runtime/support-abcdefghij";

/** A runtime built outside the system under test. */
export function importedRuntime(stack: Stack): IBedrockAgentRuntime {
  return Runtime.fromAgentRuntimeAttributes(stack, "Imported", {
    agentRuntimeArn: RUNTIME_ARN,
    agentRuntimeId: "support-abcdefghij",
    agentRuntimeName: "support",
    roleArn: "arn:aws:iam::123456789012:role/agent",
  });
}

/** A role to grant to. */
export function callerRole(stack: Stack): Role {
  return new Role(stack, "Caller", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
}
