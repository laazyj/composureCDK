import { describe, expect, it } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { Gateway, Memory } from "aws-cdk-lib/aws-bedrockagentcore";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { gatewayGrants, memoryGrants, runtimeGrants } from "../src/grants.js";
import { callerRole, importedRuntime, RUNTIME_ARN } from "./fixtures.js";

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
    const caller = callerRole(stack);

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

const MEMORY_CAPABILITIES = [
  ["write", ["bedrock-agentcore:CreateEvent"]],
  ["read", ["bedrock-agentcore:ListEvents", "bedrock-agentcore:RetrieveMemoryRecords"]],
  ["readShortTerm", ["bedrock-agentcore:ListEvents"]],
  ["readLongTerm", ["bedrock-agentcore:RetrieveMemoryRecords"]],
  ["readWrite", ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:RetrieveMemoryRecords"]],
  ["delete", ["bedrock-agentcore:DeleteEvent", "bedrock-agentcore:DeleteMemoryRecord"]],
] as const;

describe("memoryGrants", () => {
  it("covers every capability memoryGrants exposes", () => {
    assertCapabilitiesCovered(memoryGrants, MEMORY_CAPABILITIES);
  });

  it.each(MEMORY_CAPABILITIES)("%s grants %j", (capability, actions) => {
    const stack = newStack();
    const memory = new Memory(stack, "Memory");
    const caller = callerRole(stack);

    memoryGrants[capability](memory).applyTo(caller, {});

    for (const action of actions) expect(policyJson(stack)).toContain(action);
  });

  it("gives an agent no control-plane access", () => {
    const stack = newStack();
    const caller = callerRole(stack);

    memoryGrants.readWrite(new Memory(stack, "Memory")).applyTo(caller, {});

    const policy = JSON.stringify(Template.fromStack(stack).findResources("AWS::IAM::Policy"));
    expect(policy).not.toMatch(/(Create|Get|Update|Delete)Memory"/);
  });
});

describe("gatewayGrants", () => {
  const GATEWAY_CAPABILITIES = [["invoke", "bedrock-agentcore:InvokeGateway"]] as const;

  it("covers every capability gatewayGrants exposes", () => {
    assertCapabilitiesCovered(gatewayGrants, GATEWAY_CAPABILITIES);
  });

  it.each(GATEWAY_CAPABILITIES)("%s grants %s", (capability, action) => {
    const stack = newStack();

    gatewayGrants[capability](new Gateway(stack, "Gateway")).applyTo(callerRole(stack), {});

    expect(policyJson(stack)).toContain(action);
  });
});
