import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createDualFunctionApp } from "../src/dual-function-app.js";

describe("dual-function-app", () => {
  const { stack } = createDualFunctionApp();
  const template = Template.fromStack(stack);

  it("creates two Lambda functions", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("creates two IAM execution roles", () => {
    template.resourceCountIs("AWS::IAM::Role", 2);
  });

  it("configures the API handler", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 256,
      Timeout: 30,
      TracingConfig: { Mode: "Active" },
      Description: "API handler — receives and validates incoming requests",
    });
  });

  it("configures the worker", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Handler: "index.handler",
      MemorySize: 512,
      Timeout: 300,
      TracingConfig: { Mode: "Active" },
      Description: "Worker — processes requests asynchronously",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
