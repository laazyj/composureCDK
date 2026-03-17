import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { createDualFunctionApp } from "../src/dual-function-app.js";

function synthTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const system = createDualFunctionApp();
  system.build(stack, "DualFunctionApp");
  return Template.fromStack(stack);
}

describe("dual-function-app", () => {
  it("creates two Lambda functions", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("creates two IAM execution roles", () => {
    const template = synthTemplate();

    template.resourceCountIs("AWS::IAM::Role", 2);
  });

  it("configures the API handler", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      MemorySize: 256,
      Timeout: 30,
      TracingConfig: { Mode: "Active" },
      Description: "API handler — receives and validates incoming requests",
    });
  });

  it("configures the worker", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      MemorySize: 512,
      Timeout: 300,
      TracingConfig: { Mode: "Active" },
      Description: "Worker — processes requests asynchronously",
    });
  });

  it("matches the expected synthesised template", () => {
    const template = synthTemplate();

    expect(template.toJSON()).toMatchSnapshot();
  });
});
