import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Template } from "aws-cdk-lib/assertions";
import { Code, LoggingFormat, Runtime, Tracing, Architecture } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
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
        .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs22.x",
        Handler: "index.handler",
      });
    });

    it("creates a Lambda function with custom memory size", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .description("Handles API requests"),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: "Handles API requests",
      });
    });

    it("creates exactly one Lambda function, one IAM role, and one LogGroup", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.resourceCountIs("AWS::Lambda::Function", 1);
      template.resourceCountIs("AWS::IAM::Role", 1);
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates an execution role with the Lambda service principal", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
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
          .runtime(Runtime.NODEJS_22_X)
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
        Runtime: "nodejs22.x",
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

  describe("secure defaults", () => {
    it("enables X-Ray active tracing by default", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        TracingConfig: { Mode: "Active" },
      });
    });

    it("enables JSON structured logging by default", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        LoggingConfig: Match.objectLike({ LogFormat: "JSON" }),
      });
    });

    it("allows the user to override tracing", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .tracing(Tracing.PASS_THROUGH),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        TracingConfig: { Mode: "PassThrough" },
      });
    });

    it("allows the user to override logging format", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .loggingFormat(LoggingFormat.TEXT),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        LoggingConfig: Match.objectLike({ LogFormat: "Text" }),
      });
    });
  });

  describe("logging", () => {
    it("creates a managed LogGroup by default", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("returns the auto-created LogGroup in the build result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .build(stack, "TestFunction");

      expect(result.logGroup).toBeDefined();
    });

    it("applies RETAIN removal policy on the auto-created LogGroup", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResource("AWS::Logs::LogGroup", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    it("applies TWO_YEARS retention on the auto-created LogGroup", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("configures the Lambda function to use the auto-created LogGroup", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::Lambda::Function", {
        LoggingConfig: Match.objectLike({
          LogGroup: Match.anyValue(),
        }),
      });
    });

    it("skips auto LogGroup when user provides their own", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup", {
        retention: RetentionDays.ONE_WEEK,
      });

      const result = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .logGroup(userLogGroup)
        .build(stack, "TestFunction");

      expect(result.logGroup).toBeUndefined();
      const template = Template.fromStack(stack);
      // Only the user-provided LogGroup, no auto-created one
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 7,
      });
    });
  });

  describe("tagging", () => {
    it("applies builder tags to the function and the auto-created log group sibling", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .tag("Owner", "platform")
        .tag("Project", "claude-rig")
        .build(stack, "TestFunction");

      const template = Template.fromStack(stack);
      const fns = template.findResources("AWS::Lambda::Function") as Record<
        string,
        { Properties: { Tags?: { Key: string; Value: string }[] } }
      >;
      expect(Object.values(fns)[0]?.Properties.Tags).toEqual(
        expect.arrayContaining([
          { Key: "Owner", Value: "platform" },
          { Key: "Project", Value: "claude-rig" },
        ]),
      );
      const logGroups = template.findResources("AWS::Logs::LogGroup") as Record<
        string,
        { Properties: { Tags?: { Key: string; Value: string }[] } }
      >;
      expect(Object.values(logGroups)[0]?.Properties.Tags).toEqual(
        expect.arrayContaining([{ Key: "Owner", Value: "platform" }]),
      );
    });
  });
});
