import { describe, it, expect } from "vitest";
import { Duration, Size } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Metric, Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { EbsDeviceVolumeType, type Volume } from "aws-cdk-lib/aws-ec2";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createVolumeBuilder } from "../src/volume-builder.js";

const buildAndSynth = buildFixture(
  () =>
    createVolumeBuilder()
      .availabilityZone("us-east-1a")
      .size(Size.gibibytes(50))
      .volumeType(EbsDeviceVolumeType.GP3),
  "TestVolume",
);

/** The burstable volume type most of these alarms are specific to. */
const buildBurstable = buildFixture(
  () =>
    createVolumeBuilder()
      .availabilityZone("us-east-1a")
      .size(Size.gibibytes(50))
      .volumeType(EbsDeviceVolumeType.GP2),
  "TestVolume",
);

describe("recommended volume alarms", () => {
  describe("defaults", () => {
    it("does NOT create burstBalance alarm for non-burstable gp3 volumes", () => {
      const { result, template } = buildAndSynth();

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("contextual burstBalance alarm", () => {
    it("creates burstBalance alarm for gp2 (IOPS-credit) volumes", () => {
      const { result, template } = buildBurstable();

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
      const { result } = buildAndSynth((b) => {
        b.volumeType(EbsDeviceVolumeType.ST1);
        b.size(Size.gibibytes(500));
      });

      expect(result.alarms.burstBalance).toBeDefined();
    });

    it("creates burstBalance alarm for sc1 (cold-credit) volumes", () => {
      const { result } = buildAndSynth((b) => {
        b.volumeType(EbsDeviceVolumeType.SC1);
        b.size(Size.gibibytes(500));
      });

      expect(result.alarms.burstBalance).toBeDefined();
    });

    it("does NOT create burstBalance alarm for io2 volumes", () => {
      const { result, template } = buildAndSynth((b) => {
        b.volumeType(EbsDeviceVolumeType.IO2);
        b.iops(3000);
      });

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("includes threshold justification in the description", () => {
      const { template } = buildBurstable();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        AlarmDescription: Match.stringLikeRegexp("Threshold: < 20%"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing burstBalance threshold on a burstable volume", () => {
      const { template } = buildBurstable((b) =>
        b.recommendedAlarms({ burstBalance: { threshold: 10 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        Threshold: 10,
      });
    });

    it("allows customizing treatMissingData", () => {
      const { template } = buildBurstable((b) =>
        b.recommendedAlarms({
          burstBalance: { treatMissingData: TreatMissingData.BREACHING },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildBurstable((b) => b.recommendedAlarms(false));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildBurstable((b) => b.recommendedAlarms({ enabled: false }));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables burstBalance explicitly on a burstable volume", () => {
      const { result, template } = buildBurstable((b) =>
        b.recommendedAlarms({ burstBalance: false }),
      );

      expect(result.alarms.burstBalance).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildBurstable();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "BurstBalance",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("volume addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildBurstable((b) =>
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
    const { result, template } = buildBurstable((b) => customAlarm(b.recommendedAlarms(false)));

    expect(Object.keys(result.alarms)).toEqual(["volumeQueueLength"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildBurstable((b) =>
      customAlarm(b.recommendedAlarms({ enabled: false })),
    );

    expect(Object.keys(result.alarms)).toEqual(["volumeQueueLength"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});
