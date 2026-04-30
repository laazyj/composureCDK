import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { createBucketBuilder } from "../src/bucket-builder.js";

function buildResult(configureFn: (builder: ReturnType<typeof createBucketBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createBucketBuilder();
  configureFn(builder);
  const result = builder.build(stack, "TestBucket");
  return { result, template: Template.fromStack(stack) };
}

function withAlarms(builder: ReturnType<typeof createBucketBuilder>) {
  builder.serverAccessLogs(false).metrics([{ id: "EntireBucket" }]);
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates no alarms without metrics configured", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates serverErrors and clientErrors alarms when metrics are configured", () => {
      const { result, template } = buildResult(withAlarms);

      expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates alarms for each metrics configuration", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false).metrics([
          { id: "EntireBucket" },
          { id: "UploadsOnly", prefix: "uploads/" },
        ]);
      });

      expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["serverErrors:UploadsOnly"]).toBeDefined();
      expect(result.alarms["clientErrors:UploadsOnly"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    });

    it("creates serverErrors alarm with threshold > 0", () => {
      const { template } = buildResult(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Namespace: "AWS/S3",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 300,
      });
    });

    it("creates clientErrors alarm with threshold > 0", () => {
      const { template } = buildResult(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4xxErrors",
        Namespace: "AWS/S3",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 300,
      });
    });

    it("includes FilterId dimension from metrics configuration", () => {
      const { template } = buildResult((b) => {
        b.serverAccessLogs(false).metrics([{ id: "MyFilter" }]);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "FilterId", Value: "MyFilter" })]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 0"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing serverErrors alarm threshold", () => {
      const { template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: { threshold: 10 },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Threshold: 10,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            clientErrors: { evaluationPeriods: 5, datapointsToAlarm: 3 },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4xxErrors",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: { treatMissingData: TreatMissingData.BREACHING },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            enabled: false,
          });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: false,
          });
      });

      expect(result.alarms["serverErrors:EntireBucket"]).toBeUndefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: false,
            clientErrors: false,
          });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b) => {
      b.serverAccessLogs(false)
        .metrics([{ id: "EntireBucket" }])
        .addAlarm("totalRequests", (alarm) =>
          alarm
            .metric(
              (bucket) =>
                new Metric({
                  namespace: "AWS/S3",
                  metricName: "GetRequests",
                  dimensionsMap: {
                    BucketName: bucket.bucketName,
                    FilterId: "EntireBucket",
                  },
                  period: Duration.minutes(5),
                }),
            )
            .threshold(100)
            .lessThan()
            .description("Bucket traffic has dropped below expected level"),
        );
    });

    expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
    expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
    expect(result.alarms.totalRequests).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildResult((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .addAlarm("serverErrors:EntireBucket", (alarm) =>
            alarm
              .metric(
                (bucket) =>
                  new Metric({
                    namespace: "AWS/S3",
                    metricName: "5xxErrors",
                    dimensionsMap: {
                      BucketName: bucket.bucketName,
                      FilterId: "EntireBucket",
                    },
                    period: Duration.minutes(5),
                  }),
              )
              .description("Duplicate"),
          );
      }),
    ).toThrow(/Duplicate alarm key "serverErrors:EntireBucket"/);
  });
});
