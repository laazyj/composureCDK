import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { keyGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const key = new Key(stack, "Key");
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, key, role };
}

const CAPABILITIES = [
  ["encrypt", "kms:Encrypt"],
  ["decrypt", "kms:Decrypt"],
  ["encryptDecrypt", "kms:GenerateDataKey*"],
  ["sign", "kms:Sign"],
  ["verify", "kms:Verify"],
  ["signVerify", "kms:Sign"],
  ["generateMac", "kms:GenerateMac"],
  ["verifyMac", "kms:VerifyMac"],
  ["admin", "kms:ScheduleKeyDeletion"],
] as const;

describe("keyGrants", () => {
  it("covers every capability keyGrants exposes", () => {
    assertCapabilitiesCovered(keyGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s grants the matching action", (capability, action) => {
    const { stack, key, role } = setup();

    keyGrants[capability](key).applyTo(role, {});

    expect(policyJson(stack)).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("admin does not grant cryptographic use of the key", () => {
    const { stack, key, role } = setup();

    keyGrants.admin(key).applyTo(role, {});

    const policy = Template.fromStack(stack).findResources("AWS::IAM::Policy");
    const actions = JSON.stringify(Object.values(policy));
    expect(actions).not.toContain("kms:Encrypt");
    expect(actions).not.toContain("kms:Decrypt");
  });

  it("resolves a Resolvable key from the build context before granting", () => {
    const { stack, key, role } = setup();

    keyGrants
      .decrypt(ref<{ key: Key }, Key>("tableKey", (r) => r.key))
      .applyTo(role, { tableKey: { key } });

    expect(policyJson(stack)).toContain("kms:Decrypt");
  });
});
