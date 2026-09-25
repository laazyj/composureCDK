import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  AgentRuntimeArtifact,
  RuntimeNetworkConfiguration,
} from "aws-cdk-lib/aws-bedrockagentcore";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { type IGrantable, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { type Grant, ref } from "@composurecdk/core";
import { createRuntimeBuilder } from "../src/runtime-builder.js";

const IMAGE = "123456789012.dkr.ecr.eu-west-2.amazonaws.com/agent:1";

const publicRuntime = () =>
  createRuntimeBuilder()
    .runtimeName("support")
    .agentRuntimeArtifact(AgentRuntimeArtifact.fromImageUri(IMAGE))
    .networkConfiguration(RuntimeNetworkConfiguration.usingPublicNetwork());

const buildAndSynth = buildFixture(publicRuntime, "Agent");

const buildWithoutNetwork = buildFixture(
  () => createRuntimeBuilder().agentRuntimeArtifact(AgentRuntimeArtifact.fromImageUri(IMAGE)),
  "Agent",
);

const invokeModelGrant: Grant<IGrantable> = {
  applyTo: (grantee) => {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: ["*"] }),
    );
  },
};

describe("createRuntimeBuilder", () => {
  describe("network", () => {
    it("requires an explicit network", () => {
      expect(() => buildWithoutNetwork()).toThrow(/requires a network.*BedrockAgentCore\.1/s);
    });

    it("rejects both a VPC and a network configuration", () => {
      expect(() => buildAndSynth((b, stack) => b.vpc(new Vpc(stack, "Vpc")))).toThrow(
        /\.vpc\(\) and \.networkConfiguration\(\) are exclusive/,
      );
    });

    it("accepts public networking when chosen", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
        NetworkConfiguration: { NetworkMode: "PUBLIC" },
      });
    });

    it("runs in a VPC from the build context, with an HTTPS-only security group", () => {
      const stack = newStack();
      const vpc = new Vpc(stack, "Vpc");
      const build = (id: string) =>
        createRuntimeBuilder()
          .agentRuntimeArtifact(AgentRuntimeArtifact.fromImageUri(IMAGE))
          .vpc(ref<{ vpc: Vpc }>("network").get("vpc"))
          .build(stack, id, { network: { vpc } });

      const { securityGroup } = build("First");
      build("Second");

      expect(securityGroup).toBeDefined();
      Template.fromStack(stack).hasResourceProperties("AWS::EC2::SecurityGroup", {
        SecurityGroupEgress: [
          Match.objectLike({ CidrIp: "0.0.0.0/0", IpProtocol: "tcp", FromPort: 443, ToPort: 443 }),
        ],
      });

      const runtimes = Object.values(
        Template.fromStack(stack).findResources("AWS::BedrockAgentCore::Runtime"),
      ) as { Properties: { NetworkConfiguration: { NetworkMode: string } } }[];
      expect(runtimes.map((r) => r.Properties.NetworkConfiguration.NetworkMode)).toEqual([
        "VPC",
        "VPC",
      ]);
    });

    it("uses supplied security groups", () => {
      const { template, result } = buildWithoutNetwork((b, stack) => {
        const vpc = new Vpc(stack, "Vpc");
        b.vpc(vpc).securityGroups([new SecurityGroup(stack, "Sg", { vpc })]);
      });

      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
      expect(result.securityGroup).toBeUndefined();
    });
  });

  it("requires an artifact", () => {
    const build = buildFixture(createRuntimeBuilder, "Agent");

    expect(() => build()).toThrow(/requires an agentRuntimeArtifact/);
  });

  it("enables tracing by default", () => {
    const { template } = buildAndSynth();

    template.resourceCountIs("AWS::Logs::DeliverySource", 1);
    template.hasResourceProperties("AWS::Logs::DeliverySource", { LogType: "TRACES" });
  });

  it("allows tracing to be turned off", () => {
    const { template } = buildAndSynth((b) => b.tracingEnabled(false));

    template.resourceCountIs("AWS::Logs::DeliverySource", 0);
  });

  it("resolves environment variables from the build context", () => {
    const { template } = buildAndSynth(
      (b) =>
        b.environmentVariables({
          MODEL_ID: "eu.anthropic.claude",
          TABLE: ref<{ name: string }>("table").get("name"),
        }),
      { context: { table: { name: "orders" } } },
    );

    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      EnvironmentVariables: { MODEL_ID: "eu.anthropic.claude", TABLE: "orders" },
    });
  });

  it("uses a supplied execution role", () => {
    const { template } = buildAndSynth((b, stack) =>
      b.executionRole(Role.fromRoleName(stack, "Imported", "agent-role")),
    );

    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      RoleArn: { "Fn::Join": ["", Match.arrayWith([":role/agent-role"])] },
    });
    expect(JSON.stringify(template.findResources("AWS::IAM::Role"))).not.toContain(
      "bedrock-agentcore.amazonaws.com",
    );
  });

  it("applies grants to the execution role", () => {
    const { template } = buildAndSynth((b) => b.grant(invokeModelGrant));

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: "bedrock:InvokeModel" })]),
      },
    });
  });

  it("sets retention on the DEFAULT endpoint's log group once the runtime exists", () => {
    const { template, result } = buildAndSynth();

    template.hasResourceProperties("Custom::LogRetention", {
      LogGroupName: {
        "Fn::Join": ["", ["/aws/bedrock-agentcore/runtimes/", Match.anyValue(), "-DEFAULT"]],
      },
      RetentionInDays: 731,
    });
    template.resourceCountIs("AWS::Logs::LogGroup", 0);
    expect(result.logRetention.node.dependencies).toContain(result.runtime);
  });

  describe("alarms", () => {
    it("alarms on system errors, throttles and user errors on the DEFAULT endpoint", () => {
      const { template, result } = buildAndSynth();

      expect(Object.keys(result.alarms)).toEqual(["systemErrors", "throttles", "userErrors"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "UserErrors",
        Threshold: 0,
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Bedrock-AgentCore",
        MetricName: "SystemErrors",
        Statistic: "Sum",
        Period: 60,
        Threshold: 0,
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
        TreatMissingData: "notBreaching",
        Dimensions: Match.arrayWith([
          { Name: "Name", Value: "support::DEFAULT" },
          { Name: "Operation", Value: "InvokeAgentRuntime" },
        ]),
      });
    });

    it("creates opt-in alarms when configured", () => {
      const { result, template } = buildAndSynth((b) =>
        b.recommendedAlarms({
          throttles: false,
          userErrors: { threshold: 5 },
          latency: { threshold: 30_000 },
        }),
      );

      expect(Object.keys(result.alarms)).toEqual(["systemErrors", "userErrors", "latency"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Latency",
        ExtendedStatistic: "p90",
        Threshold: 30_000,
      });
    });

    it("requires a threshold for an opt-in alarm", () => {
      expect(() => buildAndSynth((b) => b.recommendedAlarms({ latency: {} }))).toThrow(
        /"latency" alarm has no default threshold/,
      );
    });

    it.each([false as const, { enabled: false }])("disables recommended alarms with %o", (cfg) => {
      const { result } = buildAndSynth((b) =>
        b.recommendedAlarms(cfg).addAlarm("invocations", (a) =>
          a
            .metric((m) => m.metric("Invocations"))
            .threshold(100)
            .greaterThan(),
        ),
      );

      expect(Object.keys(result.alarms)).toEqual(["invocations"]);
    });
  });

  describe("endpoints", () => {
    it("adds endpoints with their own log group and alarms", () => {
      const { template, result } = buildAndSynth((b) => b.addEndpoint("prod", { version: "2" }));

      template.hasResourceProperties("AWS::BedrockAgentCore::RuntimeEndpoint", {
        Name: "prod",
        AgentRuntimeVersion: "2",
      });
      template.hasResource("Custom::LogRetention", {
        Properties: Match.objectLike({
          LogGroupName: { "Fn::Join": ["", Match.arrayWith(["-prod"])] },
        }),
        DependsOn: Match.arrayWith([Match.stringLikeRegexp("Endpointprod")]),
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "SystemErrors",
        Dimensions: Match.arrayWith([{ Name: "Name", Value: "support::prod" }]),
      });
      expect(Object.keys(result.endpoints.prod.alarms)).toEqual([
        "systemErrors",
        "throttles",
        "userErrors",
      ]);
    });

    it.each(["DEFAULT", "prod"])("rejects a duplicate endpoint %s", (name) => {
      expect(() => publicRuntime().addEndpoint("prod").addEndpoint(name)).toThrow(
        `"${name}" is already an endpoint`,
      );
    });
  });

  it("copies endpoints, grants and custom alarms independently", () => {
    const base = publicRuntime().addEndpoint("prod");
    const copy = base
      .copy()
      .addEndpoint("staging")
      .grant(invokeModelGrant)
      .addAlarm("sessions", (a) =>
        a
          .metric((m) => m.metric("SessionCount"))
          .threshold(10)
          .greaterThan(),
      );

    const build = (b: typeof base) => b.build(newStack(), "Agent");
    expect(Object.keys(build(base).endpoints)).toEqual(["prod"]);
    const copied = build(copy);
    expect(Object.keys(copied.endpoints)).toEqual(["prod", "staging"]);
    expect(Object.keys(copied.alarms)).toContain("sessions");
  });

  it("tags the runtime", () => {
    const { template } = buildAndSynth((b) => b.tag("Project", "support"));

    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      Tags: { Project: "support" },
    });
  });
});
