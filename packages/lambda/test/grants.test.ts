import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { functionGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const fn = new LambdaFunction(stack, "Fn", {
    runtime: Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {};"),
  });
  const role = new Role(stack, "Role", {
    assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
  });
  return { stack, fn, role };
}

describe("functionGrants", () => {
  it.each([
    ["invoke", "lambda:InvokeFunction"],
    ["invokeUrl", "lambda:InvokeFunctionUrl"],
  ] as const)("%s delegates to the matching native grant method", (capability, action) => {
    const { stack, fn, role } = setup();

    functionGrants[capability](fn).applyTo(role, {});

    expect(policyJson(stack)).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable function from the build context before granting", () => {
    const { stack, fn, role } = setup();

    functionGrants
      .invoke(ref<{ function: LambdaFunction }, LambdaFunction>("handler", (r) => r.function))
      .applyTo(role, { handler: { function: fn } });

    expect(policyJson(stack)).toContain("lambda:InvokeFunction");
  });
});
