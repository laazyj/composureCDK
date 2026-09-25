import { describe, it } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { assertCapabilitiesCovered, newStack } from "@composurecdk/cdk-testing";
import { runtimeGrants } from "../src/grants.js";
import { importedRuntime, RUNTIME_ARN } from "./fixtures.js";

const CAPABILITIES = [
  ["invoke", "bedrock-agentcore:InvokeAgentRuntime"],
  ["invokeForUser", "bedrock-agentcore:InvokeAgentRuntimeForUser"],
] as const;

describe("runtimeGrants", () => {
  it("covers every capability runtimeGrants exposes", () => {
    assertCapabilitiesCovered(runtimeGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s grants %s on the runtime and its endpoints", (capability, action) => {
    const stack = newStack();
    const caller = new Role(stack, "Caller", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });

    runtimeGrants[capability](importedRuntime(stack)).applyTo(caller, {});

    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          { Action: action, Effect: "Allow", Resource: [RUNTIME_ARN, `${RUNTIME_ARN}/*`] },
        ],
      },
    });
  });
});
