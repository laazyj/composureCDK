import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ref } from "@composurecdk/core";
import { tableGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S");
  const table = new Table(stack, "Table", {
    partitionKey: { name: "id", type: AttributeType.STRING },
  });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, table, role };
}

// The granted actions land on the role's policy; asserting on the rendered
// template keeps us decoupled from whether CDK emits a single action or an array.
const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

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
