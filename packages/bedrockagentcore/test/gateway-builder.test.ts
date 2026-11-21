import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import type { Stack } from "aws-cdk-lib";
import {
  type Gateway,
  GatewayAuthorizer,
  GatewayCredentialProvider,
  type GatewayTarget,
  SchemaDefinitionType,
  ToolSchema,
} from "aws-cdk-lib/aws-bedrockagentcore";
import { type IRole, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { assertAssignable, buildFixture, newStack, policyJson } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { compose, ref } from "@composurecdk/core";
import { createGatewayBuilder, type GatewayBuilderResult } from "../src/gateway-builder.js";

const buildAndSynth = buildFixture(() => createGatewayBuilder().gatewayName("tools"), "Gateway");

const toolSchema = ToolSchema.fromInline([
  {
    name: "get_order",
    description: "Look up an order",
    inputSchema: { type: SchemaDefinitionType.OBJECT },
  },
]);

describe("createGatewayBuilder", () => {
  it("authorizes inbound requests with IAM, without a Cognito user pool", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
      AuthorizerType: "AWS_IAM",
    });
    template.resourceCountIs("AWS::Cognito::UserPool", 0);
  });

  it("allows another authorizer", () => {
    const { template } = buildAndSynth((b) =>
      b.authorizerConfiguration(
        GatewayAuthorizer.usingCustomJwt({
          discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
          allowedAudience: ["tools"],
        }),
      ),
    );

    template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
      AuthorizerType: "CUSTOM_JWT",
    });
  });

  it.each([
    ["a named gateway", () => createGatewayBuilder().gatewayName("tools"), /^tools\*$/],
    ["a generated name", createGatewayBuilder, /^\w+Gateway\w+\*$/],
  ])("trusts the service only for %s", (_, factory, name) => {
    const { template } = buildFixture(factory, "Gateway")();

    const [role] = Object.values(template.findResources("AWS::IAM::Role")) as {
      Properties: { AssumeRolePolicyDocument: { Statement: Record<string, unknown>[] } };
    }[];
    const [statement] = role.Properties.AssumeRolePolicyDocument.Statement;
    expect(statement).toMatchObject({
      Principal: { Service: "bedrock-agentcore.amazonaws.com" },
      Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
    });
    const sourceArn = JSON.stringify(statement.Condition);
    expect(sourceArn.split(":gateway/")[1]?.split('"')[0]).toMatch(name);
  });

  it("uses a supplied role from the build context", () => {
    const stack = newStack();
    const role = Role.fromRoleName(stack, "Imported", "gateway-role");
    const { gateway } = createGatewayBuilder()
      .role(ref<{ role: IRole }>("iam").get("role"))
      .build(stack, "Gateway", { iam: { role } });

    expect(gateway.role).toBe(role);
  });

  it.each([
    ["its own role", (b: ReturnType<typeof createGatewayBuilder>) => b],
    [
      "a supplied role",
      (b: ReturnType<typeof createGatewayBuilder>, stack: Stack) =>
        b.role(
          new Role(stack, "Supplied", {
            assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
          }),
        ),
    ],
  ])("grants %s the customer managed key", (_, configure) => {
    const { stack, template } = buildAndSynth((b, s) => configure(b.kmsKey(new Key(s, "Key")), s));

    template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
      KmsKeyArn: Match.anyValue(),
    });
    expect(policyJson(stack)).toContain("kms:CreateGrant");
  });

  describe("targets", () => {
    it("adds a Lambda target with the function from the build context", () => {
      const stack = newStack();
      const fn = new LambdaFunction(stack, "Orders", {
        runtime: Runtime.NODEJS_22_X,
        handler: "index.handler",
        code: Code.fromInline("exports.handler = async () => ({});"),
      });
      const { targets } = createGatewayBuilder()
        .addLambdaTarget("orders", {
          lambdaFunction: ref<{ fn: LambdaFunction }>("orders").get("fn"),
          toolSchema,
        })
        .build(stack, "Gateway", { orders: { fn } });

      expect(Object.keys(targets)).toEqual(["orders"]);
      Template.fromStack(stack).hasResourceProperties("AWS::BedrockAgentCore::GatewayTarget", {
        Name: "orders",
      });
      expect(policyJson(stack)).toContain("lambda:InvokeFunction");
    });

    it("adds any target through a factory", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addTarget("search", (gateway, id) =>
          gateway.addMcpServerTarget(id, {
            endpoint: "https://mcp.example.com",
            credentialProviderConfigurations: [GatewayCredentialProvider.fromIamRole()],
          }),
        ),
      );

      expect(Object.keys(result.targets)).toEqual(["search"]);
      template.resourceCountIs("AWS::BedrockAgentCore::GatewayTarget", 1);
    });

    it("rejects a duplicate key", () => {
      const factory = () => ({}) as GatewayTarget;
      expect(() => createGatewayBuilder().addTarget("a", factory).addTarget("a", factory)).toThrow(
        'duplicate key "a"',
      );
    });
  });

  describe("alarms", () => {
    it("alarms on system errors and throttles", () => {
      const { template, result } = buildAndSynth();

      expect(Object.keys(result.alarms)).toEqual(["systemErrors", "throttles"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Bedrock-AgentCore",
        MetricName: "SystemErrors",
        Period: 60,
        Dimensions: Match.arrayWith([{ Name: "Operation", Value: "InvokeGateway" }]),
      });
    });

    it("creates the opt-in target execution time alarm", () => {
      const { template, result } = buildAndSynth((b) =>
        b.recommendedAlarms({
          targetExecutionTime: { threshold: 5000 },
          userErrors: { threshold: 5 },
        }),
      );

      expect(Object.keys(result.alarms)).toEqual([
        "systemErrors",
        "throttles",
        "userErrors",
        "targetExecutionTime",
      ]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "TargetExecutionTime",
        ExtendedStatistic: "p90",
        Threshold: 5000,
      });
    });
  });

  it("copies targets and custom alarms independently", () => {
    const mcp = (gateway: Gateway, id: string) =>
      gateway.addMcpServerTarget(id, {
        endpoint: `https://${id}.example.com`,
        credentialProviderConfigurations: [GatewayCredentialProvider.fromIamRole()],
      });
    const base = createGatewayBuilder().recommendedAlarms(false).addTarget("search", mcp);
    const copy = base
      .copy()
      .addTarget("docs", mcp)
      .addAlarm("invocations", (a) =>
        a
          .metric((m) => m.metric("Invocations"))
          .threshold(1000)
          .greaterThan(),
      );

    const built = base.build(newStack(), "Gateway");
    const copied = copy.build(newStack(), "Gateway");
    expect([Object.keys(built.targets), Object.keys(built.alarms)]).toEqual([["search"], []]);
    expect([Object.keys(copied.targets), Object.keys(copied.alarms)]).toEqual([
      ["search", "docs"],
      ["invocations"],
    ]);
  });

  it("tags the gateway", () => {
    const { template } = buildAndSynth((b) => b.tag("Project", "support"));

    template.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
      Tags: { Project: "support" },
    });
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        invocations: (a) =>
          a
            .metric((m) => m.metric("Invocations"))
            .threshold(1000)
            .greaterThan(),
        sessions: (a) =>
          a
            .metric((m) => m.metric("SessionCount"))
            .threshold(10)
            .greaterThan(),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["invocations", "sessions"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: GatewayBuilderResult = result;
    const errors = typed.alarms.systemErrors;

    assertAssignable<Alarm | undefined, typeof errors>();
    assertAssignable<Alarm | undefined, typeof typed.alarms.targetExecutionTime>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof errors>();
    expect(errors).toBeDefined();
    // @ts-expect-error -- "systemError" is not a gateway alarm key
    expect(typed.alarms.systemError).toBeUndefined();
  });

  it("resolves a declared custom key through a typed ref, and rejects an undeclared one", () => {
    const system = compose(
      {
        gateway: createGatewayBuilder()
          .gatewayName("tools")
          .addAlarm("invocations", (a) =>
            a
              .metric((m) => m.metric("Invocations"))
              .threshold(1000)
              .greaterThan(),
          ),
        consumer: {
          build: (_scope: unknown, _id: string, context: Record<string, object>) => ({
            alarm: ref("gateway", (r: WithCustomAlarms<GatewayBuilderResult, "invocations">) => {
              // @ts-expect-error -- "invocation" was not declared as a custom key
              expect(r.alarms.invocation).toBeUndefined();
              return r.alarms.invocations;
            }).resolve(context),
          }),
        },
      },
      { gateway: [], consumer: ["gateway"] },
    );

    const built = system.build(newStack(), "System");
    assertAssignable<Alarm, typeof built.consumer.alarm>();
    expect(built.consumer.alarm).toBe(built.gateway.alarms.invocations);
  });
});
