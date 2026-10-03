import { describe, expect, it } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DefinitionBody, Pass, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { stateMachineGrants } from "../src/grants.js";

function setup() {
  const stack = newStack();
  const stateMachine = new StateMachine(stack, "Workflow", {
    definitionBody: DefinitionBody.fromChainable(new Pass(stack, "Pass")),
  });
  const role = new Role(stack, "Caller", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  return { stack, stateMachine, role };
}

const CAPABILITIES = [
  ["startExecution", "states:StartExecution"],
  ["startSyncExecution", "states:StartSyncExecution"],
  ["read", "states:DescribeExecution"],
  ["taskResponse", "states:SendTaskSuccess"],
  ["redriveExecution", "states:RedriveExecution"],
] as const;

describe("stateMachineGrants", () => {
  it("covers every capability stateMachineGrants exposes", () => {
    assertCapabilitiesCovered(stateMachineGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s delegates to the native grant method", (capability, action) => {
    const { stack, stateMachine, role } = setup();

    stateMachineGrants[capability](stateMachine).applyTo(role, {});

    const template = Template.fromStack(stack);
    expect(JSON.stringify(template.toJSON())).toContain(action);
    template.resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable state machine from the build context before granting", () => {
    const { stack, stateMachine, role } = setup();

    stateMachineGrants
      .startExecution(ref<{ stateMachine: StateMachine }>("workflow").get("stateMachine"))
      .applyTo(role, { workflow: { stateMachine } });

    expect(policyJson(stack)).toContain("states:StartExecution");
  });
});
