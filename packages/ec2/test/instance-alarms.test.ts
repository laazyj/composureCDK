import { describe, it, expect } from "vitest";
import { Duration } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type Alarm, Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { InstanceClass, InstanceSize, InstanceType, type Instance } from "aws-cdk-lib/aws-ec2";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { assertAssignable } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import { buildInstance as buildAndSynth } from "./_helpers.js";
import { createInstanceBuilder, type InstanceBuilderResult } from "../src/instance-builder.js";

const ALWAYS_ON_ALARM_KEYS = [
  "cpuUtilization",
  "statusCheckFailed",
  "attachedEbsStatusCheckFailed",
] as const;

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates cpuUtilization, statusCheckFailed, and attachedEbsStatusCheckFailed alarms for any instance type", () => {
      const { result, template } = buildAndSynth((b) =>
        b.instanceType(InstanceType.of(InstanceClass.M7G, InstanceSize.LARGE)),
      );

      expect(result.alarms.cpuUtilization).toBeDefined();
      expect(result.alarms.statusCheckFailed).toBeDefined();
      expect(result.alarms.attachedEbsStatusCheckFailed).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("creates cpuUtilization alarm with > 80% threshold", () => {
      const { template } = buildAndSynth();

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
      const { template } = buildAndSynth();

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

    it("creates attachedEbsStatusCheckFailed alarm with >= 1 threshold over 10 minutes", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "StatusCheckFailed_AttachedEBS",
        Threshold: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        EvaluationPeriods: 10,
        DatapointsToAlarm: 10,
        TreatMissingData: "notBreaching",
        Statistic: "Maximum",
        Period: 60,
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 80%"),
      });
    });
  });

  describe("contextual cpuCreditBalance alarm", () => {
    it("creates cpuCreditBalance alarm for T3 burstable instances", () => {
      const { result, template } = buildAndSynth((b) =>
        b.instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MICRO)),
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
      const { result } = buildAndSynth((b) =>
        b.instanceType(InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL)),
      );

      expect(result.alarms.cpuCreditBalance).toBeDefined();
    });

    it("does NOT create cpuCreditBalance alarm for non-burstable (M-family) instances", () => {
      const { result, template } = buildAndSynth((b) =>
        b.instanceType(InstanceType.of(InstanceClass.M7G, InstanceSize.LARGE)),
      );

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("does NOT create cpuCreditBalance alarm for non-burstable (C-family) instances", () => {
      const { result } = buildAndSynth((b) =>
        b.instanceType(InstanceType.of(InstanceClass.C7G, InstanceSize.LARGE)),
      );

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
    });
  });

  describe("customization", () => {
    it("allows customizing cpuUtilization threshold", () => {
      const { template } = buildAndSynth((b) => {
        b.recommendedAlarms({ cpuUtilization: { threshold: 50 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        Threshold: 50,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildAndSynth((b) => {
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
      const { template } = buildAndSynth((b) => {
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
      const { template } = buildAndSynth((b) => {
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
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it.each(
      ALWAYS_ON_ALARM_KEYS.map((key) => ({
        key,
        others: [...ALWAYS_ON_ALARM_KEYS.filter((other) => other !== key), "cpuCreditBalance"],
      })),
    )("disables only the $key alarm when set to false", ({ key, others }) => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms({ [key]: false });
      });

      expect(result.alarms[key]).toBeUndefined();
      for (const other of others) {
        expect(result.alarms[other]).toBeDefined();
      }
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("disables cpuCreditBalance explicitly on a burstable instance", () => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms({ cpuCreditBalance: false });
      });

      expect(result.alarms.cpuCreditBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "CPUUtilization",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildAndSynth((b) => {
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
    expect(result.alarms.attachedEbsStatusCheckFailed).toBeDefined();
    expect(result.alarms.networkIn).toBeDefined();
    // t3.micro: cpu + status + attachedEbs + cpuCreditBalance + 1 custom = 5
    template.resourceCountIs("AWS::CloudWatch::Alarm", 5);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "NetworkIn",
      Threshold: 1_000_000_000,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmDescription: "High inbound network traffic",
    });
  });

  // Regression: disabling the recommended alarms must not drop custom alarms
  // added via addAlarm() — see issue #305.
  function customAlarm(builder: ReturnType<typeof createInstanceBuilder>) {
    return builder.addAlarm("networkIn", (alarm) =>
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
  }

  it("keeps a custom alarm when recommendedAlarms is false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms(false));
    });

    expect(Object.keys(result.alarms)).toEqual(["networkIn"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms({ enabled: false }));
    });

    expect(Object.keys(result.alarms)).toEqual(["networkIn"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const ec2Metric = (metricName: string) => (instance: Instance) =>
      new Metric({
        namespace: "AWS/EC2",
        metricName,
        dimensionsMap: { InstanceId: instance.instanceId },
        statistic: Stats.AVERAGE,
        period: Duration.minutes(1),
      });
    const { result, template } = buildAndSynth((b) => {
      b.recommendedAlarms(false).addAlarms({
        networkIn: (alarm) => alarm.metric(ec2Metric("NetworkIn")).threshold(1_000_000_000),
        networkOut: (alarm) => alarm.metric(ec2Metric("NetworkOut")).threshold(1_000_000_000),
      });
    });

    expect(Object.keys(result.alarms)).toEqual(["networkIn", "networkOut"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth(() => undefined);
    const typed: InstanceBuilderResult = result;
    const status = typed.alarms.statusCheckFailed;

    assertAssignable<Alarm | undefined, typeof status>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof status>();
    expect(status).toBeDefined();
    // @ts-expect-error -- "statusCheckFailure" is not an EC2 instance alarm key
    expect(typed.alarms.statusCheckFailure).toBeUndefined();
  });

  it("types per-attachment alarm keys by suffix", () => {
    const { result } = buildAndSynth(() => undefined);
    const typed: InstanceBuilderResult = result;

    assertAssignable<Alarm | undefined, (typeof typed.alarms)["AgentData.volumeStalledIo"]>();
    // @ts-expect-error -- the suffix is ".volumeStalledIo", not ".volumeStalledIO"
    expect(typed.alarms["AgentData.volumeStalledIO"]).toBeUndefined();
    // @ts-expect-error -- a per-attachment key needs its attachment-key prefix
    expect(typed.alarms.volumeStalledIo).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b) => {
      b.addAlarm("networkIn", (alarm) =>
        alarm
          .metric(
            (instance) =>
              new Metric({
                namespace: "AWS/EC2",
                metricName: "NetworkIn",
                dimensionsMap: { InstanceId: instance.instanceId },
                statistic: Stats.AVERAGE,
                period: Duration.minutes(1),
              }),
          )
          .threshold(1_000_000_000),
      );
    });
    const alarm = ref("server", (r: WithCustomAlarms<InstanceBuilderResult, "networkIn">) => {
      // @ts-expect-error -- "networkOut" was not declared as a custom key
      expect(r.alarms.networkOut).toBeUndefined();
      return r.alarms.networkIn;
    }).resolve({ server: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.networkIn);
  });
});
