import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { createDistributionBuilder } from "../src/distribution-builder.js";

function buildResult(
  configureFn: (builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createDistributionBuilder();
  configureFn(builder, stack);
  const result = builder.build(stack, "TestDistribution");
  return { result, template: Template.fromStack(stack) };
}

function withOrigin(builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  builder.origin(S3BucketOrigin.withOriginAccessControl(bucket)).accessLogging(false);
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates errorRate and originLatency alarms by default", () => {
      const { result, template } = buildResult(withOrigin);

      expect(result.alarms.errorRate).toBeDefined();
      expect(result.alarms.originLatency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates errorRate alarm with threshold > 5%", () => {
      const { template } = buildResult(withOrigin);

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
      const { template } = buildResult(withOrigin);

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
      const { template } = buildResult(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "Region", Value: "Global" })]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 5%"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing errorRate alarm threshold", () => {
      const { template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: { threshold: 10 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        Threshold: 10,
      });
    });

    it("allows customizing originLatency threshold", () => {
      const { template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ originLatency: { threshold: 3000 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "OriginLatency",
        Threshold: 3000,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b, stack) => {
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
      const { template } = buildResult((b, stack) => {
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
      const { result, template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: false });
      });

      expect(result.alarms.errorRate).toBeUndefined();
      expect(result.alarms.originLatency).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildResult((b, stack) => {
        withOrigin(b, stack);
        b.recommendedAlarms({ errorRate: false, originLatency: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult(withOrigin);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrorRate",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b, stack) => {
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
      buildResult((b, stack) => {
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
