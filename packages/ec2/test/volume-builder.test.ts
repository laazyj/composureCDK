import { describe, it, expect } from "vitest";
import { App, RemovalPolicy, Size, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EbsDeviceVolumeType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Key } from "aws-cdk-lib/aws-kms";
import { ref } from "@composurecdk/core";
import { createVolumeBuilder } from "../src/volume-builder.js";
import { createVpcBuilder } from "../src/vpc-builder.js";

function buildVolume(configureFn?: (b: ReturnType<typeof createVolumeBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createVolumeBuilder().availabilityZone("us-east-1a").size(Size.gibibytes(50));
  configureFn?.(builder);
  const result = builder.build(stack, "TestVolume");
  return { stack, result, template: Template.fromStack(stack) };
}

describe("VolumeBuilder", () => {
  describe("build", () => {
    it("returns a VolumeBuilderResult with volume + alarms", () => {
      const { result } = buildVolume();

      expect(result.volume).toBeDefined();
      expect(result.alarms).toBeDefined();
    });

    it("creates exactly one EBS volume", () => {
      const { template } = buildVolume();

      template.resourceCountIs("AWS::EC2::Volume", 1);
    });

    it("passes through size and availability zone", () => {
      const { template } = buildVolume();

      template.hasResourceProperties("AWS::EC2::Volume", {
        Size: 50,
        AvailabilityZone: "us-east-1a",
      });
    });

    it("throws a clear error when availabilityZone is not provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createVolumeBuilder().size(Size.gibibytes(10));

      expect(() => builder.build(stack, "TestVolume")).toThrow(/availability zone/i);
    });

    it("resolves a Ref-based availabilityZone from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const { vpc } = createVpcBuilder().build(stack, "Network");

      const result = createVolumeBuilder()
        .availabilityZone(ref<{ vpc: Vpc }>("network").map((r) => r.vpc.availabilityZones[0]))
        .size(Size.gibibytes(20))
        .build(stack, "TestVolume", { network: { vpc } });

      expect(result.volume).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::EC2::Volume", 1);
    });

    it("resolves a Ref-based encryptionKey from context", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const key = new Key(stack, "ProvidedKey");

      createVolumeBuilder()
        .availabilityZone("us-east-1a")
        .size(Size.gibibytes(10))
        .encryptionKey(ref<{ key: Key }>("kms").get("key"))
        .build(stack, "TestVolume", { kms: { key } });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::EC2::Volume", {
        Encrypted: true,
        KmsKeyId: Match.anyValue(),
      });
    });
  });

  describe("secure defaults", () => {
    it("defaults to GP3", () => {
      const { template } = buildVolume();

      template.hasResourceProperties("AWS::EC2::Volume", {
        VolumeType: "gp3",
      });
    });

    it("encrypts at rest with the account default KMS key", () => {
      const { template } = buildVolume();

      template.hasResourceProperties("AWS::EC2::Volume", {
        Encrypted: true,
        KmsKeyId: Match.absent(),
      });
    });

    it("enables autoEnableIo so the instance can boot unattended", () => {
      const { template } = buildVolume();

      template.hasResourceProperties("AWS::EC2::Volume", {
        AutoEnableIO: true,
      });
    });

    it("retains the volume on stack deletion", () => {
      const { template } = buildVolume();

      template.hasResource("AWS::EC2::Volume", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });
  });

  describe("user overrides", () => {
    it("allows flipping removalPolicy to DESTROY", () => {
      const { template } = buildVolume((b) => {
        b.removalPolicy(RemovalPolicy.DESTROY);
      });

      template.hasResource("AWS::EC2::Volume", {
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
      });
    });

    it("allows overriding the volumeType to gp2", () => {
      const { template } = buildVolume((b) => {
        b.volumeType(EbsDeviceVolumeType.GP2);
      });

      template.hasResourceProperties("AWS::EC2::Volume", {
        VolumeType: "gp2",
      });
    });

    it("allows opting into Multi-Attach", () => {
      const { template } = buildVolume((b) => {
        b.volumeType(EbsDeviceVolumeType.IO2).iops(3000).enableMultiAttach(true);
      });

      template.hasResourceProperties("AWS::EC2::Volume", {
        MultiAttachEnabled: true,
      });
    });
  });
});
