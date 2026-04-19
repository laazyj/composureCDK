import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Vpc,
  type Instance,
} from "aws-cdk-lib/aws-ec2";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { createInstanceBuilder } from "../src/instance-builder.js";

function buildInstance(
  configureFn?: (builder: ReturnType<typeof createInstanceBuilder>) => void,
  instanceType: InstanceType = InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 });
  const builder = createInstanceBuilder()
    .vpc(vpc)
    .instanceType(instanceType)
    .machineImage(MachineImage.latestAmazonLinux2023());
  configureFn?.(builder);
  const result = builder.build(stack, "TestInstance");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates cpuUtilization and statusCheckFailed alarms for any instance type", () => {
      const { result, template } = buildInstance(
        undefined,
        InstanceType.of(InstanceClass.M7G, InstanceSize.LARGE),
      );

      expect(result.alarms.cpuUtilization).toBeDefined();
      expect(result.alarms.statusCheckFailed).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates cpuUtilization alarm with > 80% threshold", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        Threshold: 80,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        Statistic: "Average",
        Period: 60,
      });
    });

    it("creates statusCheckFailed alarm with > 0 threshold", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "StatusCheckFailed",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 2,
        DatapointsToAlarm: 2,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 80%"),
      });
    });
  });

  describe("contextual cpuCreditBalance alarm", () => {
    it("creates cpuCreditBalance alarm for T3 burstable instances", () => {
      const { result, template } = buildInstance(
        undefined,
        InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      );

      expect(result.alarms.cpuCreditBalance).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUCreditBalance",
        Threshold: 50,
        ComparisonOperator: "LessThanThreshold",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        Statistic: "Minimum",
        Period: 300,
      });
    });

    it("creates cpuCreditBalance alarm for T4g burstable instances", () => {
      const { result } = buildInstance(
        undefined,
        InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
      );

      expect(result.alarms.cpuCreditBalance).toBeDefined();
    });

    it("does NOT create cpuCreditBalance alarm for non-burstable (M-family) instances", () => {
      const { result, template } = buildInstance(
        undefined,
        InstanceType.of(InstanceClass.M7G, InstanceSize.LARGE),
      );

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("does NOT create cpuCreditBalance alarm for non-burstable (C-family) instances", () => {
      const { result } = buildInstance(
        undefined,
        InstanceType.of(InstanceClass.C7G, InstanceSize.LARGE),
      );

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
    });
  });

  describe("customization", () => {
    it("allows customizing cpuUtilization threshold", () => {
      const { template } = buildInstance((b) => {
        b.recommendedAlarms({ cpuUtilization: { threshold: 50 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        Threshold: 50,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildInstance((b) => {
        b.recommendedAlarms({
          statusCheckFailed: { evaluationPeriods: 5, datapointsToAlarm: 3 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "StatusCheckFailed",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildInstance((b) => {
        b.recommendedAlarms({
          cpuUtilization: { treatMissingData: TreatMissingData.BREACHING },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        TreatMissingData: "breaching",
      });
    });

    it("allows customizing cpuCreditBalance threshold on burstable instances", () => {
      const { template } = buildInstance((b) => {
        b.recommendedAlarms({ cpuCreditBalance: { threshold: 25 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUCreditBalance",
        Threshold: 25,
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildInstance((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildInstance((b) => {
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildInstance((b) => {
        b.recommendedAlarms({ cpuUtilization: false });
      });

      expect(result.alarms.cpuUtilization).toBeUndefined();
      expect(result.alarms.statusCheckFailed).toBeDefined();
      expect(result.alarms.cpuCreditBalance).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("disables cpuCreditBalance explicitly on a burstable instance", () => {
      const { result, template } = buildInstance((b) => {
        b.recommendedAlarms({ cpuCreditBalance: false });
      });

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildInstance();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildInstance((b) => {
      b.addAlarm("networkIn", (alarm) =>
        alarm
          .metric(
            (instance: Instance) =>
              new Metric({
                namespace: "AWS/EC2",
                metricName: "NetworkIn",
                dimensionsMap: { InstanceId: instance.instanceId },
                statistic: Stats.AVERAGE,
                period: Duration.minutes(1),
              }),
          )
          .threshold(1_000_000_000)
          .greaterThanOrEqual()
          .description("High inbound network traffic"),
      );
    });

    expect(result.alarms.cpuUtilization).toBeDefined();
    expect(result.alarms.statusCheckFailed).toBeDefined();
    expect(result.alarms.networkIn).toBeDefined();
    // t3.micro: 2 recommended (cpu, status) + cpuCreditBalance + 1 custom = 4
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "NetworkIn",
      Threshold: 1_000_000_000,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmDescription: "High inbound network traffic",
    });
  });
});
