import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  KeyPair,
  MachineImage,
  SecurityGroup,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ref } from "@composurecdk/core";
import { createInstanceBuilder } from "../src/instance-builder.js";
import { createVpcBuilder } from "../src/vpc-builder.js";

function buildInstance(configureFn?: (builder: ReturnType<typeof createInstanceBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
  const builder = createInstanceBuilder()
    .vpc(vpc)
    .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
    .machineImage(MachineImage.latestAmazonLinux2023());
  configureFn?.(builder);
  const result = builder.build(stack, "TestInstance");
  return { stack, vpc, result, template: Template.fromStack(stack) };
}

describe("InstanceBuilder", () => {
  describe("build", () => {
    it("returns an InstanceBuilderResult with an instance property", () => {
      const { result } = buildInstance();

      expect(result).toBeDefined();
      expect(result.instance).toBeDefined();
      expect(result.alarms).toBeDefined();
    });

    it("creates exactly one EC2 instance", () => {
      const { template } = buildInstance();

      template.resourceCountIs("AWS::EC2::Instance", 1);
    });

    it("passes through instanceType", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::EC2::Instance", {
        InstanceType: "t3.micro",
      });
    });

    it("throws a clear error when vpc is not provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createInstanceBuilder()
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023());

      expect(() => builder.build(stack, "TestInstance")).toThrow(/requires a VPC/);
    });

    it("resolves a Ref-based role from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const role = new Role(stack, "ProvidedRole", {
        assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      });

      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .role(ref<{ role: Role }>("iam").get("role"))
        .build(stack, "TestInstance", { iam: { role } });

      const template = Template.fromStack(stack);
      // Only the provided role exists; the builder did not create a default one.
      template.resourceCountIs("AWS::IAM::Role", 1);
    });

    it("resolves a Ref-based keyPair from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const keyPair = new KeyPair(stack, "ProvidedKeyPair", { keyPairName: "ref-key" });

      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .keyPair(ref<{ keyPair: KeyPair }>("access").get("keyPair"))
        .build(stack, "TestInstance", { access: { keyPair } });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::Instance", {
        KeyName: Match.anyValue(),
      });
    });

    it("resolves a Ref-based securityGroup from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const sg = new SecurityGroup(stack, "ProvidedSG", { vpc, allowAllOutbound: false });

      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .securityGroup(ref<{ sg: SecurityGroup }>("network").get("sg"))
        .build(stack, "TestInstance", { network: { sg } });

      const template = Template.fromStack(stack);
      // VPC default SG + the resolved SG. No extra instance-created SG.
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });

    it("resolves a Ref-based vpc from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const { vpc } = createVpcBuilder().build(stack, "Network");

      const builder = createInstanceBuilder()
        .vpc(ref<{ vpc: Vpc }>("network").get("vpc"))
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023());

      const result = builder.build(stack, "TestInstance", { network: { vpc } });

      expect(result.instance).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::Instance", 1);
    });
  });

  describe("secure defaults", () => {
    it("requires IMDSv2", () => {
      const { template } = buildInstance();

      template.hasResource("AWS::EC2::LaunchTemplate", {
        Properties: Match.objectLike({
          LaunchTemplateData: Match.objectLike({
            MetadataOptions: Match.objectLike({
              HttpTokens: "required",
            }),
          }),
        }),
      });
    });

    it("enables detailed (1-minute) CloudWatch monitoring", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::EC2::Instance", {
        Monitoring: true,
      });
    });

    it("enables EBS-optimized networking", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::EC2::Instance", {
        EbsOptimized: true,
      });
    });

    it("encrypts the root EBS volume with GP3", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::EC2::Instance", {
        BlockDeviceMappings: Match.arrayWith([
          Match.objectLike({
            DeviceName: "/dev/xvda",
            Ebs: Match.objectLike({
              Encrypted: true,
              VolumeType: "gp3",
            }),
          }),
        ]),
      });
    });

    it("attaches the AmazonSSMManagedInstanceCore managed policy by default", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::IAM::Role", {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              Match.arrayWith([Match.stringLikeRegexp("AmazonSSMManagedInstanceCore")]),
            ]),
          }),
        ]),
      });
    });
  });

  describe("user overrides", () => {
    it("allows overriding the security group", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const userSg = new SecurityGroup(stack, "UserSG", { vpc, allowAllOutbound: false });

      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .securityGroup(userSg)
        .build(stack, "TestInstance");

      const template = Template.fromStack(stack);
      // VPC default SG + the user's SG. No extra instance-created SG.
      template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });
  });
});
