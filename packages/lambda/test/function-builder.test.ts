import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Code, Runtime, Tracing, Architecture } from "aws-cdk-lib/aws-lambda";
import { createFunctionBuilder } from "../src/function-builder.js";

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createFunctionBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createFunctionBuilder();
  configureFn(builder);
  builder.build(stack, "TestFunction");
  return Template.fromStack(stack);
}

describe("FunctionBuilder", () => {
  describe("build", () => {
    it("returns a FunctionBuilderResult with a function property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createFunctionBuilder();

      builder
        .runtime(Runtime.NODEJS_20_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"));

      const result = builder.build(stack, "TestFunction");

      expect(result).toBeDefined();
      expect(result.function).toBeDefined();
    });
  });

  describe("synthesised output", () => {
    it("creates a Lambda function with the specified runtime", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs20.x",
        Handler: "index.handler",
      });
    });

    it("creates a Lambda function with custom memory size", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .memorySize(512),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        MemorySize: 512,
      });
    });

    it("creates a Lambda function with custom timeout", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .timeout(Duration.seconds(60)),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Timeout: 60,
      });
    });

    it("creates a Lambda function with tracing enabled", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .tracing(Tracing.ACTIVE),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        TracingConfig: { Mode: "Active" },
      });
    });

    it("creates a Lambda function with ARM64 architecture", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .architecture(Architecture.ARM_64),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Architectures: ["arm64"],
      });
    });

    it("creates a Lambda function with environment variables", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .environment({ TABLE_NAME: "my-table", REGION: "us-east-1" }),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: {
            TABLE_NAME: "my-table",
            REGION: "us-east-1",
          },
        },
      });
    });

    it("creates a Lambda function with description", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .description("Handles API requests"),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: "Handles API requests",
      });
    });

    it("creates exactly one Lambda function and one IAM role", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.resourceCountIs("AWS::Lambda::Function", 1);
      template.resourceCountIs("AWS::IAM::Role", 1);
    });

    it("creates an execution role with the Lambda service principal", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: { Service: "lambda.amazonaws.com" },
            },
          ],
        },
      });
    });

    it("creates a Lambda function with multiple configurations combined", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_20_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .memorySize(1024)
          .timeout(Duration.minutes(5))
          .tracing(Tracing.ACTIVE)
          .architecture(Architecture.ARM_64)
          .environment({ STAGE: "prod" })
          .description("Production handler"),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs20.x",
        Handler: "index.handler",
        MemorySize: 1024,
        Timeout: 300,
        TracingConfig: { Mode: "Active" },
        Architectures: ["arm64"],
        Description: "Production handler",
        Environment: {
          Variables: { STAGE: "prod" },
        },
      });
    });
  });
});
