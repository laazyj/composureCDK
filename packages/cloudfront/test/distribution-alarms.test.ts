import { describe, it, expect } from "vitest";
import { Duration, Stack } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createDistributionBuilder } from "../src/distribution-builder.js";

const buildAndSynth = buildFixture(createDistributionBuilder, "TestDistribution");

function withOrigin(builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  builder.origin(new HttpOrigin(bucket.bucketRegionalDomainName)).accessLogs(false);
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates errorRate and originLatency alarms by default", () => {
      const { result, template } = buildAndSynth(withOrigin);

      expect(result.alarms.errorRate).toBeDefined();
      expect(result.alarms.originLatency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates errorRate alarm with threshold > 5%", () => {
      const { template } = buildAndSynth(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        Namespace: "AWS/CloudFront",
        Threshold: 5,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        Statistic: "Average",
        Period: 60,
      });
    });

    it("creates originLatency alarm with threshold > 5000ms", () => {
      const { template } = buildAndSynth(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "OriginLatency",
        Namespace: "AWS/CloudFront",
        Threshold: 5000,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        ExtendedStatistic: "p90",
        Period: 60,
      });
    });

    it("includes DistributionId and Region=Global dimensions", () => {
      const { template } = buildAndSynth(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "Region", Value: "Global" })]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildAndSynth(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 5%"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing errorRate alarm threshold", () => {
      const { template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: { threshold: 10 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        Threshold: 10,
      });
    });

    it("allows customizing originLatency threshold", () => {
      const { template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ originLatency: { threshold: 3000 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "OriginLatency",
        Threshold: 3000,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({
          errorRate: { evaluationPeriods: 3, datapointsToAlarm: 2 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({
          errorRate: { treatMissingData: TreatMissingData.BREACHING },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: false });
      });

      expect(result.alarms.errorRate).toBeUndefined();
      expect(result.alarms.originLatency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: false, originLatency: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildAndSynth(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.addAlarm("functionErrors", (alarm) =>
        alarm
          .metric(
            (dist) =>
              new Metric({
                namespace: "AWS/CloudFront",
                metricName: "FunctionExecutionErrors",
                dimensionsMap: {
                  DistributionId: dist.distributionId,
                  FunctionName: "MyFunction",
                  Region: "Global",
                },
                statistic: "Sum",
                period: Duration.minutes(1),
              }),
          )
          .threshold(0)
          .greaterThan()
          .description("CloudFront function execution errors detected"),
      );
    });

    expect(result.alarms.errorRate).toBeDefined();
    expect(result.alarms.originLatency).toBeDefined();
    expect(result.alarms.functionErrors).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionExecutionErrors",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildAndSynth((b, stack) => {
        withOrigin(b, stack);
        b.addAlarm("errorRate", (alarm) =>
          alarm
            .metric(
              (dist) =>
                new Metric({
                  namespace: "AWS/CloudFront",
                  metricName: "5xxErrorRate",
                  dimensionsMap: {
                    DistributionId: dist.distributionId,
                    Region: "Global",
                  },
                  period: Duration.minutes(1),
                }),
            )
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "errorRate"/);
  });
});
