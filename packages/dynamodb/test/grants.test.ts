import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { tableGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
  });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, table, role };
}

describe("tableGrants", () => {
  it.each([
    ["read", ["dynamodb:GetItem"]],
    ["write", ["dynamodb:PutItem"]],
    ["readWrite", ["dynamodb:GetItem", "dynamodb:PutItem"]],
    ["fullAccess", ["dynamodb:*"]],
  ] as const)("%s delegates to the matching native grant method", (capability, actions) => {
    const { stack, table, role } = setup();

    tableGrants[capability](table).applyTo(role, {});

    const json = policyJson(stack);
    for (const action of actions) expect(json).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable table from the build context before granting", () => {
    const { stack, table, role } = setup();

    tableGrants
      .readWrite(ref<{ table: Table }, Table>("store", (r) => r.table))
      .applyTo(role, { store: { table } });

    expect(policyJson(stack)).toContain("dynamodb:PutItem");
  });
});
