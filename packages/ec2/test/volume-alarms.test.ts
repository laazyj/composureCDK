import { describe, it, expect } from "vitest";
import { App, Duration, Size, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric, Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { EbsDeviceVolumeType, type Volume } from "aws-cdk-lib/aws-ec2";
import { createVolumeBuilder } from "../src/volume-builder.js";

function buildVolume(
  configureFn?: (b: ReturnType<typeof createVolumeBuilder>) => void,
  volumeType: EbsDeviceVolumeType = EbsDeviceVolumeType.GP3,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createVolumeBuilder()
    .availabilityZone("us-east-1a")
    .size(Size.gibibytes(50))
    .volumeType(volumeType);
  configureFn?.(builder);
  const result = builder.build(stack, "TestVolume");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended volume alarms", () => {
  describe("defaults", () => {
    it("does NOT create burstBalance alarm for non-burstable gp3 volumes", () => {
      const { result, template } = buildVolume();

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("contextual burstBalance alarm", () => {
    it("creates burstBalance alarm for gp2 (IOPS-credit) volumes", () => {
      const { result, template } = buildVolume(undefined, EbsDeviceVolumeType.GP2);

      expect(result.alarms.burstBalance).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        Namespace: "AWS/EBS",
        Threshold: 20,
        ComparisonOperator: "LessThanThreshold",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        Statistic: "Average",
        Period: 300,
      });
    });

    it("creates burstBalance alarm for st1 (throughput-credit) volumes", () => {
      const { result } = buildVolume((b) => b.size(Size.gibibytes(500)), EbsDeviceVolumeType.ST1);

      expect(result.alarms.burstBalance).toBeDefined();
    });

    it("creates burstBalance alarm for sc1 (cold-credit) volumes", () => {
      const { result } = buildVolume((b) => b.size(Size.gibibytes(500)), EbsDeviceVolumeType.SC1);

      expect(result.alarms.burstBalance).toBeDefined();
    });

    it("does NOT create burstBalance alarm for io2 volumes", () => {
      const { result, template } = buildVolume((b) => b.iops(3000), EbsDeviceVolumeType.IO2);

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("includes threshold justification in the description", () => {
      const { template } = buildVolume(undefined, EbsDeviceVolumeType.GP2);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        AlarmDescription: Match.stringLikeRegexp("Threshold: < 20%"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing burstBalance threshold on a burstable volume", () => {
      const { template } = buildVolume(
        (b) => b.recommendedAlarms({ burstBalance: { threshold: 10 } }),
        EbsDeviceVolumeType.GP2,
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        Threshold: 10,
      });
    });

    it("allows customizing treatMissingData", () => {
      const { template } = buildVolume(
        (b) =>
          b.recommendedAlarms({
            burstBalance: { treatMissingData: TreatMissingData.BREACHING },
          }),
        EbsDeviceVolumeType.GP2,
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildVolume(
        (b) => b.recommendedAlarms(false),
        EbsDeviceVolumeType.GP2,
      );

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildVolume(
        (b) => b.recommendedAlarms({ enabled: false }),
        EbsDeviceVolumeType.GP2,
      );

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables burstBalance explicitly on a burstable volume", () => {
      const { result, template } = buildVolume(
        (b) => b.recommendedAlarms({ burstBalance: false }),
        EbsDeviceVolumeType.GP2,
      );

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildVolume(undefined, EbsDeviceVolumeType.GP2);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("volume addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildVolume(
      (b) =>
        b.addAlarm("volumeQueueLength", (alarm) =>
          alarm
            .metric(
              (volume: Volume) =>
                new Metric({
                  namespace: "AWS/EBS",
                  metricName: "VolumeQueueLength",
                  dimensionsMap: { VolumeId: volume.volumeId },
                  statistic: Stats.AVERAGE,
                  period: Duration.minutes(5),
                }),
            )
            .threshold(10)
            .greaterThan()
            .description("EBS volume queue length is high"),
        ),
      EbsDeviceVolumeType.GP2,
    );

    expect(result.alarms.burstBalance).toBeDefined();
    expect(result.alarms.volumeQueueLength).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "VolumeQueueLength",
      Threshold: 10,
      AlarmDescription: "EBS volume queue length is high",
    });
  });

  // Regression: disabling the recommended alarms must not drop custom alarms
  // added via addAlarm() — see issue #305.
  function customAlarm(builder: ReturnType<typeof createVolumeBuilder>) {
    return builder.addAlarm("volumeQueueLength", (alarm) =>
      alarm
        .metric(
          (volume: Volume) =>
            new Metric({
              namespace: "AWS/EBS",
              metricName: "VolumeQueueLength",
              dimensionsMap: { VolumeId: volume.volumeId },
              statistic: Stats.AVERAGE,
              period: Duration.minutes(5),
            }),
        )
        .threshold(10)
        .greaterThan()
        .description("EBS volume queue length is high"),
    );
  }

  it("keeps a custom alarm when recommendedAlarms is false", () => {
    // GP2 is burstable, so burstBalance would normally be created — proving the
    // recommended set is fully suppressed while the custom alarm survives.
    const { result, template } = buildVolume(
      (b) => customAlarm(b.recommendedAlarms(false)),
      EbsDeviceVolumeType.GP2,
    );

    expect(Object.keys(result.alarms)).toEqual(["volumeQueueLength"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildVolume(
      (b) => customAlarm(b.recommendedAlarms({ enabled: false })),
      EbsDeviceVolumeType.GP2,
    );

    expect(Object.keys(result.alarms)).toEqual(["volumeQueueLength"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});
