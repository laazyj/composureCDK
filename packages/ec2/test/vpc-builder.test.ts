import { describe, it, expect } from "vitest";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { FlowLogDestination } from "aws-cdk-lib/aws-ec2";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { createVpcBuilder } from "../src/vpc-builder.js";

function buildVpc(configureFn?: (builder: ReturnType<typeof createVpcBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createVpcBuilder();
  configureFn?.(builder);
  const result = builder.build(stack, "Network");
  return { result, template: Template.fromStack(stack) };
}

describe("VpcBuilder", () => {
  describe("build", () => {
    it("returns a VpcBuilderResult with a vpc property", () => {
      const { result } = buildVpc();

      expect(result).toBeDefined();
      expect(result.vpc).toBeDefined();
    });

    it("creates exactly one VPC", () => {
      const { template } = buildVpc();

      template.resourceCountIs("AWS::EC2::VPC", 1);
    });
  });

  describe("well-architected defaults", () => {
    it("creates subnets across 2 availability zones by default", () => {
      const { template } = buildVpc();

      // 2 AZs x (public + private) = 4 subnets
      template.resourceCountIs("AWS::EC2::Subnet", 4);
    });

    it("creates a single NAT gateway by default", () => {
      const { template } = buildVpc();

      template.resourceCountIs("AWS::EC2::NatGateway", 1);
    });

    it("restricts the default security group via a custom resource", () => {
      const { template } = buildVpc();

      // CDK's restrictDefaultSecurityGroup is implemented via a
      // Custom::VpcRestrictDefaultSG custom resource.
      template.hasResource("Custom::VpcRestrictDefaultSG", Match.anyValue());
    });

    it("auto-creates a CloudWatch LogGroup for flow logs", () => {
      const { result, template } = buildVpc();

      expect(result.flowLogsLogGroup).toBeDefined();
      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates exactly one FlowLog resource routed to CloudWatch Logs", () => {
      const { template } = buildVpc();

      template.resourceCountIs("AWS::EC2::FlowLog", 1);
      template.hasResourceProperties("AWS::EC2::FlowLog", {
        ResourceType: "VPC",
        LogDestinationType: "cloud-watch-logs",
      });
    });
  });

  describe("user overrides", () => {
    it("allows overriding natGateways", () => {
      const { template } = buildVpc((b) => {
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
      const { result, template } = buildVpc((b) => {
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
      const { result, template } = buildVpc((b) => {
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
});
