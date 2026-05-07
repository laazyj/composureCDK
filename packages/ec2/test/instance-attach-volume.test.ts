import { describe, it, expect } from "vitest";
import { App, Lazy, Size, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Volume,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { compose, ref } from "@composurecdk/core";
import { createInstanceBuilder } from "../src/instance-builder.js";
import { createVolumeBuilder, type VolumeBuilderResult } from "../src/volume-builder.js";
import { createVpcBuilder, type VpcBuilderResult } from "../src/vpc-builder.js";

describe("InstanceBuilder.attachVolume", () => {
  describe("single attachment with VolumeBuilderResult ref", () => {
    function buildAgent() {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = compose(
        {
          network: createVpcBuilder().maxAzs(2).natGateways(0),
          data: createVolumeBuilder()
            .availabilityZone(
              ref<VpcBuilderResult>("network").map((r) => r.vpc.availabilityZones[0]),
            )
            .size(Size.gibibytes(20)),
          agent: createInstanceBuilder()
            .vpc(ref<VpcBuilderResult>("network").map((r) => r.vpc))
            .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
            .machineImage(MachineImage.latestAmazonLinux2023())
            .attachVolume("AgentData", ref<VolumeBuilderResult>("data"), {
              device: "/dev/sdf",
            }),
        },
        { network: [], data: ["network"], agent: ["network", "data"] },
      ).build(stack, "AgentApp");
      return { stack, result, template: Template.fromStack(stack) };
    }

    it("creates exactly one VolumeAttachment", () => {
      const { template } = buildAgent();
      template.resourceCountIs("AWS::EC2::VolumeAttachment", 1);
    });

    it("exposes the attachment in InstanceBuilderResult.volumeAttachments", () => {
      const { result } = buildAgent();
      expect(result.agent.volumeAttachments.AgentData).toBeDefined();
    });

    it("wires device, instanceId, and volumeId on the attachment", () => {
      const { template } = buildAgent();
      template.hasResourceProperties("AWS::EC2::VolumeAttachment", {
        Device: "/dev/sdf",
        InstanceId: Match.anyValue(),
        VolumeId: Match.anyValue(),
      });
    });

    it("creates the per-attachment volumeStalledIo alarm by default", () => {
      const { result, template } = buildAgent();

      expect(result.agent.alarms["AgentData.volumeStalledIo"]).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/EBS",
        MetricName: "VolumeStalledIOCheck",
        Statistic: "Maximum",
        Period: 60,
        Threshold: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        EvaluationPeriods: 10,
        DatapointsToAlarm: 10,
        TreatMissingData: "notBreaching",
        Dimensions: Match.arrayEquals([
          Match.objectLike({ Name: "InstanceId" }),
          Match.objectLike({ Name: "VolumeId" }),
        ]),
      });
    });
  });

  describe("Resolvable<IVolume> form", () => {
    it("accepts a bare IVolume ref by unwrapping its volumeId", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const volume = new Volume(stack, "ExternalVolume", {
        availabilityZone: vpc.availabilityZones[0],
        size: Size.gibibytes(10),
      });

      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .attachVolume(
          "Bare",
          ref<{ volume: Volume }>("ext").map((r) => r.volume),
          {
            device: "/dev/sdg",
          },
        )
        .build(stack, "AgentInstance", { ext: { volume } });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::VolumeAttachment", 1);
    });
  });

  describe("multiple attachments", () => {
    it("creates one attachment + alarm per call, namespaced by key", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = compose(
        {
          network: createVpcBuilder().maxAzs(2).natGateways(0),
          data: createVolumeBuilder()
            .availabilityZone(
              ref<VpcBuilderResult>("network").map((r) => r.vpc.availabilityZones[0]),
            )
            .size(Size.gibibytes(20)),
          logs: createVolumeBuilder()
            .availabilityZone(
              ref<VpcBuilderResult>("network").map((r) => r.vpc.availabilityZones[0]),
            )
            .size(Size.gibibytes(10)),
          agent: createInstanceBuilder()
            .vpc(ref<VpcBuilderResult>("network").map((r) => r.vpc))
            .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
            .machineImage(MachineImage.latestAmazonLinux2023())
            .attachVolume("AgentData", ref<VolumeBuilderResult>("data"), {
              device: "/dev/sdf",
            })
            .attachVolume("AgentLogs", ref<VolumeBuilderResult>("logs"), {
              device: "/dev/sdg",
            }),
        },
        {
          network: [],
          data: ["network"],
          logs: ["network"],
          agent: ["network", "data", "logs"],
        },
      ).build(stack, "AgentApp");

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::VolumeAttachment", 2);
      expect(result.agent.volumeAttachments.AgentData).toBeDefined();
      expect(result.agent.volumeAttachments.AgentLogs).toBeDefined();
      expect(result.agent.alarms["AgentData.volumeStalledIo"]).toBeDefined();
      expect(result.agent.alarms["AgentLogs.volumeStalledIo"]).toBeDefined();
    });

    it("rejects duplicate attachment keys at configuration time", () => {
      const builder = createInstanceBuilder()
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023());

      builder.attachVolume("Same", ref<VolumeBuilderResult>("data"), { device: "/dev/sdf" });

      expect(() =>
        builder.attachVolume("Same", ref<VolumeBuilderResult>("data"), { device: "/dev/sdg" }),
      ).toThrow(/duplicate attachment key/i);
    });
  });

  describe("synth-time AZ validation", () => {
    it("throws when the volume and instance AZs are concrete and mismatched", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });

      const volume = new Volume(stack, "ExternalVolume", {
        availabilityZone: "us-east-1z",
        size: Size.gibibytes(10),
      });

      const builder = createInstanceBuilder()
        .vpc(vpc)
        .availabilityZone("us-east-1a")
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .attachVolume(
          "Mismatch",
          ref<{ volume: Volume }>("ext").map((r) => r.volume),
          {
            device: "/dev/sdf",
          },
        );

      expect(() => builder.build(stack, "Agent", { ext: { volume } })).toThrow(
        /availability zone "us-east-1z".*"us-east-1a"/,
      );
    });

    it("does not throw when both AZs match", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });

      const volume = new Volume(stack, "ExternalVolume", {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(10),
      });

      expect(() =>
        createInstanceBuilder()
          .vpc(vpc)
          .availabilityZone("us-east-1a")
          .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
          .machineImage(MachineImage.latestAmazonLinux2023())
          .attachVolume(
            "Match",
            ref<{ volume: Volume }>("ext").map((r) => r.volume),
            {
              device: "/dev/sdf",
            },
          )
          .build(stack, "Agent", { ext: { volume } }),
      ).not.toThrow();
    });

    it("skips validation when the volume AZ is a CDK token", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111111111111", region: "us-east-1" },
      });
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });

      const tokenizedAz = Lazy.string({ produce: () => "us-east-1a" });
      const volumeFromAttrs = Volume.fromVolumeAttributes(stack, "ImportedVolume", {
        volumeId: "vol-deadbeef",
        availabilityZone: tokenizedAz,
      });

      expect(() =>
        createInstanceBuilder()
          .vpc(vpc)
          .availabilityZone("us-east-1z")
          .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
          .machineImage(MachineImage.latestAmazonLinux2023())
          .attachVolume("Tokenized", volumeFromAttrs, { device: "/dev/sdf" })
          .build(stack, "Agent"),
      ).not.toThrow();
    });
  });

  describe("recommendedAlarms config on attachment", () => {
    function buildAgent(opts: {
      recommendedAlarms?: false | { volumeStalledIo?: false | { threshold?: number } };
    }) {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const volume = new Volume(stack, "Vol", {
        availabilityZone: vpc.availabilityZones[0],
        size: Size.gibibytes(10),
      });
      const result = createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .attachVolume(
          "Data",
          ref<{ vol: Volume }>("ext").map((r) => r.vol),
          {
            device: "/dev/sdf",
            ...opts,
          },
        )
        .build(stack, "Agent", { ext: { vol: volume } });
      return { result, template: Template.fromStack(stack) };
    }

    it("disables the alarm when recommendedAlarms is false", () => {
      const { result } = buildAgent({ recommendedAlarms: false });
      expect(result.alarms["Data.volumeStalledIo"]).toBeUndefined();
    });

    it("disables the alarm when volumeStalledIo is false", () => {
      const { result } = buildAgent({ recommendedAlarms: { volumeStalledIo: false } });
      expect(result.alarms["Data.volumeStalledIo"]).toBeUndefined();
    });

    it("allows tuning the threshold", () => {
      const { template } = buildAgent({
        recommendedAlarms: { volumeStalledIo: { threshold: 2 } },
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "VolumeStalledIOCheck",
        Threshold: 2,
      });
    });
  });

  describe("default empty result", () => {
    it("returns an empty volumeAttachments map when no attachments are configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      const result = createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .build(stack, "Agent");

      expect(result.volumeAttachments).toEqual({});
    });

    it("does not affect existing recommended-alarms shape when no attachments are configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
      createInstanceBuilder()
        .vpc(vpc)
        .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO))
        .machineImage(MachineImage.latestAmazonLinux2023())
        .build(stack, "Agent");

      const template = Template.fromStack(stack);
      // 4 instance alarms (cpu + status + ebs + cpuCredit on T3) and zero volume-attachment alarms.
      template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
      template.resourceCountIs("AWS::EC2::VolumeAttachment", 0);
    });
  });
});
