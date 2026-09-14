import { describe, expect, it } from "vitest";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { newStack } from "../src/stack.js";
import { policyJson } from "../src/template.js";

describe("policyJson", () => {
  it("stringifies the synthesised template, so a granted action is findable", () => {
    const stack = newStack();
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    new Key(stack, "Key").grantDecrypt(role);

    expect(policyJson(stack)).toContain("kms:Decrypt");
  });
});
