import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createEc2App } from "../src/ec2-app.js";

describe("ec2-app", () => {
  const { stack } = createEc2App();
  const template = Template.fromStack(stack);

  it("creates exactly one VPC", () => {
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  it("creates exactly one EC2 instance", () => {
    template.resourceCountIs("AWS::EC2::Instance", 1);
  });

  it("creates recommended CloudWatch alarms for the instance (cpu, status, attached EBS, credit balance)", () => {
    // T3 micro => cpuUtilization + statusCheckFailed + attachedEbsStatusCheckFailed + cpuCreditBalance
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "CPUUtilization",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "StatusCheckFailed",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "StatusCheckFailed_AttachedEBS",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "CPUCreditBalance",
    });
  });

  it("creates an SNS topic for alarm actions", () => {
    template.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "EC2 Alerts",
    });
  });

  it("creates a flow log routed to CloudWatch Logs", () => {
    template.resourceCountIs("AWS::EC2::FlowLog", 1);
    template.hasResourceProperties("AWS::EC2::FlowLog", {
      LogDestinationType: "cloud-watch-logs",
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
