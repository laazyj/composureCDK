import { afterEach, describe, it, expect, vi } from "vitest";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { FlowLogDestination, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  PolicyDocument,
  PrincipalPolicyFragment,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { buildFixture, newStack, policyJson, testEnv } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createVpcBuilder } from "../src/vpc-builder.js";

const buildAndSynth = buildFixture(createVpcBuilder, "Network");

describe("VpcBuilder", () => {
  describe("build", () => {
    it("returns a VpcBuilderResult with a vpc property", () => {
      const { result } = buildAndSynth();

      expect(result).toBeDefined();
      expect(result.vpc).toBeDefined();
    });

    it("creates exactly one VPC", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::EC2::VPC", 1);
    });
  });

  describe("well-architected defaults", () => {
    it("creates subnets across 2 availability zones by default", () => {
      const { template } = buildAndSynth();

      // 2 AZs x (public + private) = 4 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    it("creates a single NAT gateway by default", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::EC2::NatGateway", 1);
    });

    it("restricts the default security group via a custom resource", () => {
      const { template } = buildAndSynth();

      // CDK's restrictDefaultSecurityGroup is implemented via a
      // Custom::VpcRestrictDefaultSG custom resource.
      template.hasResource("Custom::VpcRestrictDefaultSG", Match.anyValue());
    });

    it("auto-creates a CloudWatch LogGroup for flow logs", () => {
      const { result, template } = buildAndSynth();

      expect(result.flowLogsLogGroup).toBeDefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates exactly one FlowLog resource routed to CloudWatch Logs", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::EC2::FlowLog", 1);
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        LogDestinationType: "cloud-watch-logs",
      });
    });
  });

  // https://github.com/laazyj/composureCDK/issues/652
  describe("flow-log role", () => {
    const describeOnBareArn = (logGroupId: string) => ({
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Effect: "Allow",
            Action: "logs:DescribeLogStreams",
            Resource: {
              "Fn::Join": [
                "",
                Match.arrayWith([":log-group:", { Ref: Match.stringLikeRegexp(logGroupId) }]),
              ],
            },
          },
        ]),
      },
    });

    it("grants DescribeLogStreams on the bare Log Group ARN", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties(
        "AWS::IAM::Policy",
        describeOnBareArn("NetworkFlowLogsLogGroup"),
      );
    });

    it("keeps CDK's stream-action statement and role", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
            }),
          ]),
        },
      });
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        DeliverLogsPermissionArn: {
          "Fn::GetAtt": [Match.stringLikeRegexp("DefaultFlowLogIAMRole"), "Arn"],
        },
      });
    });

    it("also covers a user-supplied CloudWatch Logs destination", () => {
      const { template } = buildAndSynth((b, stack) => {
        b.flowLogs({
          destination: FlowLogDestination.toCloudWatchLogs(new LogGroup(stack, "UserLogs")),
        });
      });

      template.hasResourceProperties("AWS::IAM::Policy", describeOnBareArn("UserLogs"));
    });

    it("adds nothing for a non-CloudWatch destination", () => {
      const { stack } = buildAndSynth((b, s) => {
        b.flowLogs({ destination: FlowLogDestination.toS3(new Bucket(s, "UserBucket")) });
      });

      expect(policyJson(stack)).not.toContain("logs:DescribeLogStreams");
    });
  });

  // https://github.com/laazyj/composureCDK/issues/661
  describe("flow-log role trust policy", () => {
    const FLOW_LOGS = "vpc-flow-logs.amazonaws.com";
    const env = testEnv("eu-west-2");
    const CONFUSED_DEPUTY_CONDITIONS = {
      StringEquals: { "aws:SourceAccount": env.account },
      ArnLike: {
        "aws:SourceArn": {
          "Fn::Join": [
            "",
            ["arn:", { Ref: "AWS::Partition" }, `:ec2:${env.region}:${env.account}:vpc-flow-log/*`],
          ],
        },
      },
    };

    /** Every role's trust policy that names the flow-logs service. */
    const trustPolicies = (template: Template) =>
      Object.values(template.findResources("AWS::IAM::Role"))
        .map(
          (r) =>
            (r as { Properties: { AssumeRolePolicyDocument: unknown } }).Properties
              .AssumeRolePolicyDocument,
        )
        .filter((doc) => JSON.stringify(doc).includes(FLOW_LOGS));

    const trust = (condition?: object) => ({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: FLOW_LOGS },
          ...(condition && { Condition: condition }),
        },
      ],
    });

    const build = (configure?: Parameters<typeof buildAndSynth>[0]) =>
      buildAndSynth(configure, { stackProps: { env } }).template;

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Makes CDK's own `ServicePrincipal("vpc-flow-logs…")` carry `conditions`,
     * which is how an upstream fix would most likely arrive.
     */
    function simulateUpstreamConditions(conditions: Record<string, unknown>): void {
      vi.spyOn(ServicePrincipal.prototype, "policyFragment", "get").mockImplementation(function (
        this: ServicePrincipal,
      ) {
        return new PrincipalPolicyFragment(
          { Service: [this.service] },
          this.service === FLOW_LOGS ? conditions : {},
        );
      });
    }

    it("conditions CDK's role with aws:SourceAccount and aws:SourceArn", () => {
      expect(trustPolicies(build())).toEqual([trust(CONFUSED_DEPUTY_CONDITIONS)]);
    });

    // Pins the upstream shape the override depends on: one trust statement, at
    // index 0, with no conditions. If this fails, aws-cdk-lib has changed how it
    // builds the flow-log role — re-check `conditionCdkRoleTrust`. If CDK now
    // adds these conditions itself, the override has become redundant.
    it("pins the unconditioned trust policy aws-cdk-lib synthesises", () => {
      const stack = newStack({ env });
      new Vpc(stack, "Vpc", { natGateways: 0 }).addFlowLog("FlowLog");

      expect(trustPolicies(Template.fromStack(stack))).toEqual([trust()]);
    });

    it("conditions CDK's role for a user-supplied CloudWatch Logs destination", () => {
      const template = build((b, stack) => {
        b.flowLogs({
          destination: FlowLogDestination.toCloudWatchLogs(new LogGroup(stack, "UserLogs")),
        });
      });

      expect(trustPolicies(template)).toEqual([trust(CONFUSED_DEPUTY_CONDITIONS)]);
    });

    it("leaves a user-supplied role as the user wrote it", () => {
      const template = build((b, stack) => {
        const role = new Role(stack, "UserRole", { assumedBy: new ServicePrincipal(FLOW_LOGS) });
        b.flowLogs({
          destination: FlowLogDestination.toCloudWatchLogs(new LogGroup(stack, "UserLogs"), role),
        });
      });

      expect(trustPolicies(template)).toEqual([trust()]);
    });

    describe("if aws-cdk-lib conditions the role upstream", () => {
      it("synthesises the same conditions and keeps keys the builder does not set", () => {
        const orgCondition = { "aws:SourceOrgID": "o-example" };
        const upstream = {
          ...CONFUSED_DEPUTY_CONDITIONS,
          StringEquals: { ...orgCondition, ...CONFUSED_DEPUTY_CONDITIONS.StringEquals },
        };
        simulateUpstreamConditions(upstream);

        expect(trustPolicies(build())).toEqual([trust(upstream)]);
      });

      it("throws rather than condition the wrong statement", () => {
        vi.spyOn(PolicyDocument.prototype, "statementCount", "get").mockReturnValue(2);

        expect(() => build()).toThrow(/one trust statement, found 2/);
      });
    });
  });

  describe("user overrides", () => {
    it("allows overriding natGateways", () => {
      const { template } = buildAndSynth((b) => {
        b.natGateways(2);
      });

      template.resourceCountIs("AWS::EC2::NatGateway", 2);
    });

    it("allows overriding maxAzs", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });
      createVpcBuilder().maxAzs(3).build(stack, "Network");
      const template = Template.fromStack(stack);

      // 3 AZs x (public + private) = 6 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 6);
    });

    it("disables flow logs entirely when flowLogs is set to false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.flowLogs(false);
      });

      expect(result.flowLogsLogGroup).toBeUndefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 0);
      template.resourceCountIs("AWS::EC2::FlowLog", 0);
    });

    it("uses a user-provided destination without creating a LogGroup", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userBucket = new Bucket(stack, "UserBucket");

      const { result, template } = (() => {
        const r = createVpcBuilder()
          .flowLogs({ destination: FlowLogDestination.toS3(userBucket) })
          .build(stack, "Network");
        return { result: r, template: Template.fromStack(stack) };
      })();

      expect(result.flowLogsLogGroup).toBeUndefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 0);
      template.resourceCountIs("AWS::EC2::FlowLog", 1);
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        LogDestinationType: "s3",
      });
    });

    it("applies user configure callback to the auto-created LogGroup", () => {
      const { result, template } = buildAndSynth((b) => {
        b.flowLogs({
          configure: (lg) =>
            lg.retention(RetentionDays.ONE_WEEK).removalPolicy(RemovalPolicy.DESTROY),
        });
      });

      expect(result.flowLogsLogGroup).toBeDefined();
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 7,
      });
    });

    it("configure callback can reach a sibling component through a ref", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const key = new Key(stack, "FlowLogsKey");

      createVpcBuilder()
        .flowLogs({
          configure: (lg) => lg.encryptionKey(ref<{ key: Key }>("flowLogsKey").get("key")),
        })
        .build(stack, "Network", { flowLogsKey: { key } });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: { "Fn::GetAtt": [Match.stringLikeRegexp("FlowLogsKey"), "Arn"] },
      });
    });

    it("throws when both destination and configure are set", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userBucket = new Bucket(stack, "UserBucket");

      expect(() =>
        createVpcBuilder()
          .flowLogs({
            destination: FlowLogDestination.toS3(userBucket),
            configure: (lg) => lg.retention(RetentionDays.ONE_DAY),
          })
          .build(stack, "Network"),
      ).toThrow(/configure.*cannot be combined with.*destination/);
    });
  });

  describe("availabilityZones", () => {
    it("synthesizes with pinned AZs without a context lookup", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });

      createVpcBuilder().availabilityZones(["us-east-1a", "us-east-1b"]).build(stack, "Network");
      const template = Template.fromStack(stack);

      // The default maxAzs yields to the pinned AZs: 2 AZs x (public + private)
      // = 4 subnets, and synth succeeds without the maxAzs/availabilityZones clash.
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    it("throws when both availabilityZones and maxAzs are set", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });

      expect(() =>
        createVpcBuilder()
          .availabilityZones(["us-east-1a", "us-east-1b"])
          .maxAzs(2)
          .build(stack, "Network"),
      ).toThrow(/availabilityZones\(\) and \.maxAzs\(\) are mutually exclusive/);
    });
  });
});
