import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createAgentVolumeApp } from "../src/agent-volume-app.js";

describe("agent-volume-app", () => {
  const { stack } = createAgentVolumeApp();
  const template = Template.fromStack(stack);

  it("creates exactly one VPC", () => {
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  it("creates exactly one EC2 instance", () => {
    template.resourceCountIs("AWS::EC2::Instance", 1);
  });

  it("creates exactly one persistent EBS volume", () => {
    template.resourceCountIs("AWS::EC2::Volume", 1);
  });

  it("retains the volume by default (the agent-volume use case)", () => {
    template.hasResource("AWS::EC2::Volume", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("creates a VolumeAttachment wiring instance to volume at /dev/sdf", () => {
    template.resourceCountIs("AWS::EC2::VolumeAttachment", 1);
    template.hasResourceProperties("AWS::EC2::VolumeAttachment", {
      Device: "/dev/sdf",
    });
  });

  it("creates the per-attachment volumeStalledIo alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/EBS",
      MetricName: "VolumeStalledIOCheck",
    });
  });

  it("creates an SNS topic for alarm actions", () => {
    template.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "Agent Volume Alerts",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
