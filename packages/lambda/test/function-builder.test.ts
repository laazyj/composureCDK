import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  Code,
  type Function as LambdaFunction,
  LoggingFormat,
  Runtime,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createServiceRoleBuilder,
  createStatementBuilder,
  type RoleBuilderResult,
} from "@composurecdk/iam";
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

  describe("execution role", () => {
    it("attaches an inline LogsWriter policy scoped to the auto-created log group", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      template.hasResourceProperties("AWS::IAM::Role", {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: "LogsWriter",
            PolicyDocument: Match.objectLike({
              Statement: Match.arrayWith([
                Match.objectLike({
                  Effect: "Allow",
                  Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                  Resource: Match.arrayWith([
                    Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["Arn"]) }),
                  ]),
                }),
              ]),
            }),
          }),
        ]),
      });
    });

    it("does not attach the AWSLambdaBasicExecutionRole managed policy by default", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      const roles = template.findResources("AWS::IAM::Role") as Record<
        string,
        { Properties: { ManagedPolicyArns?: unknown[] } }
      >;
      const allPolicies = JSON.stringify(Object.values(roles));
      expect(allPolicies).not.toContain("AWSLambdaBasicExecutionRole");
    });

    it("does not grant logs:CreateLogGroup", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}")),
      );

      const roles = template.findResources("AWS::IAM::Role");
      const serialized = JSON.stringify(Object.values(roles));
      expect(serialized).not.toContain("logs:CreateLogGroup");
    });

    it("surfaces the auto-created role on the build result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .build(stack, "TestFunction");

      expect(result.role).toBeDefined();
      expect(result.role).toBe(result.function.role);
    });

    it(".configureRole adds inline statements alongside LogsWriter", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .configureRole((rb) =>
            rb.addInlinePolicyStatements("DynamoAccess", [
              createStatementBuilder()
                .allow()
                .actions(["dynamodb:GetItem"])
                .resources(["arn:aws:dynamodb:us-east-1:111122223333:table/Orders"]),
            ]),
          ),
      );

      template.hasResourceProperties("AWS::IAM::Role", {
        Policies: Match.arrayWith([
          Match.objectLike({ PolicyName: "LogsWriter" }),
          Match.objectLike({
            PolicyName: "DynamoAccess",
            PolicyDocument: Match.objectLike({
              Statement: Match.arrayWith([
                Match.objectLike({
                  Effect: "Allow",
                  Action: "dynamodb:GetItem",
                  Resource: "arn:aws:dynamodb:us-east-1:111122223333:table/Orders",
                }),
              ]),
            }),
          }),
        ]),
      });
    });

    it(".configureRole that supplies a duplicate LogsWriter policy throws at build time", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .configureRole((rb) =>
          rb.addInlinePolicyStatements("LogsWriter", [
            createStatementBuilder()
              .allow()
              .actions(["logs:DescribeLogGroups"])
              .resources(["*"])
              .allowWildcardResources(),
          ]),
        );

      expect(() => builder.build(stack, "TestFunction")).toThrow(/LogsWriter/);
    });

    it(".role(myRole) uses the supplied role and does not attach LogsWriter", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userRole = new Role(stack, "UserRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });

      const result = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .role(userRole)
        .build(stack, "TestFunction");

      expect(result.role).toBe(userRole);

      const template = Template.fromStack(stack);
      const roles = template.findResources("AWS::IAM::Role") as Record<
        string,
        { Properties: { Policies?: { PolicyName: string }[] } }
      >;
      for (const role of Object.values(roles)) {
        const policies = role.Properties.Policies ?? [];
        expect(policies.find((p) => p.PolicyName === "LogsWriter")).toBeUndefined();
      }
    });

    it(".role(ref(...)) resolves through compose", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const handler = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .role(ref("sharedRole", (r: RoleBuilderResult) => r.role));

      const sharedRole = createServiceRoleBuilder("lambda.amazonaws.com");

      const result = compose(
        { sharedRole, handler },
        { sharedRole: [], handler: ["sharedRole"] },
      ).build(stack, "System");

      expect(result.handler.role).toBe(result.sharedRole.role);
      expect(result.handler.function.role).toBe(result.sharedRole.role);

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Lambda::Function", 1);
      template.resourceCountIs("AWS::IAM::Role", 1);
    });

    it(".useCdkAutoRole() opts back into AWSLambdaBasicExecutionRole", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .useCdkAutoRole()
        .build(stack, "TestFunction");

      expect(result.role).toBe(result.function.role);

      const template = Template.fromStack(stack);
      const roles = template.findResources("AWS::IAM::Role");
      const serialized = JSON.stringify(Object.values(roles));
      expect(serialized).toContain("AWSLambdaBasicExecutionRole");
    });

    it("throws when .role() and .configureRole() are combined", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userRole = new Role(stack, "UserRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });

      const builder = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .role(userRole)
        .configureRole((rb) => rb.description("nope"));

      expect(() => builder.build(stack, "TestFunction")).toThrow(/mutually exclusive/);
    });

    it("throws when .role() and .useCdkAutoRole() are combined", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userRole = new Role(stack, "UserRole", {
        assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      });

      const builder = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .role(userRole)
        .useCdkAutoRole();

      expect(() => builder.build(stack, "TestFunction")).toThrow(/mutually exclusive/);
    });

    it("throws when .configureRole() and .useCdkAutoRole() are combined", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .configureRole((rb) => rb.description("nope"))
        .useCdkAutoRole();

      expect(() => builder.build(stack, "TestFunction")).toThrow(/mutually exclusive/);
    });

    it("CDK still wires X-Ray permissions onto the explicit role when tracing is active", () => {
      const template = synthTemplate((b) =>
        b
          .runtime(Runtime.NODEJS_22_X)
          .handler("index.handler")
          .code(Code.fromInline("exports.handler = async () => {}"))
          .tracing(Tracing.ACTIVE),
      );

      const policies = template.findResources("AWS::IAM::Policy");
      const serialized = JSON.stringify(Object.values(policies));
      expect(serialized).toContain("xray:PutTraceSegments");
    });

    it("CDK still wires VPC permissions onto the explicit role when a VPC is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "Vpc");

      createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async () => {}"))
        .vpc(vpc)
        .build(stack, "TestFunction");

      const template = Template.fromStack(stack);
      const roles = template.findResources("AWS::IAM::Role");
      const serialized = JSON.stringify(Object.values(roles));
      // CDK attaches AWSLambdaVPCAccessExecutionRole when a VPC is set.
      expect(serialized).toContain("AWSLambdaVPCAccessExecutionRole");
    });
  });

  describe("[COPY_STATE]", () => {
    it("preserves #customAlarms across .copy()", () => {
      const errorMetric = (fn: LambdaFunction): Metric =>
        new Metric({
          namespace: "AWS/Lambda",
          metricName: "Errors",
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: "Sum",
          period: Duration.minutes(5),
        });

      assertCopyPreservesState({
        factory: () =>
          createFunctionBuilder()
            .runtime(Runtime.NODEJS_22_X)
            .handler("index.handler")
            .code(Code.fromInline("exports.handler = async () => {}")),
        configure: (b) => {
          b.addAlarm("firstCustom", (a) => a.metric(errorMetric).threshold(1).greaterThanOrEqual());
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) =>
            a.metric(errorMetric).threshold(5).greaterThanOrEqual(),
          );
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Function"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
