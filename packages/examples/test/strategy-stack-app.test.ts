import { describe, it, expect } from "vitest";
import { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createStrategyStackApp } from "../src/strategy-stack-app.js";

function findStack(stacks: Stack[], name: string): Stack {
  const stack = stacks.find((s) => s.stackName === name);
  if (!stack) {
    throw new Error(
      `Stack "${name}" not found. Available: ${stacks.map((s) => s.stackName).join(", ")}`,
    );
  }
  return stack;
}

describe("strategy-stack-app", () => {
  const { app } = createStrategyStackApp();
  const stacks = app.node.children.filter((c): c is Stack => c instanceof Stack);
  const serviceStack = findStack(stacks, "StrategyStackApp-service");
  const gatewayStack = findStack(stacks, "StrategyStackApp-gateway");

  it("creates two stacks", () => {
    expect(stacks).toHaveLength(2);
  });

  it("places the Lambda in the service stack", () => {
    const template = Template.fromStack(serviceStack);
    template.resourceCountIs("AWS::Lambda::Function", 1);
  });

  it("places the REST API in the gateway stack", () => {
    const template = Template.fromStack(gatewayStack);
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("matches the expected service stack template", () => {
    expect(Template.fromStack(serviceStack).toJSON()).toMatchSnapshot();
  });

  it("matches the expected gateway stack template", () => {
    expect(Template.fromStack(gatewayStack).toJSON()).toMatchSnapshot();
  });
});
