import { describe, it, expect } from "vitest";
import { Duration, Stack } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type Alarm, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { assertAssignable, buildFixture } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "../src/distribution-builder.js";

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

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const distMetric = (metricName: string) => (dist: { distributionId: string }) =>
      new Metric({
        namespace: "AWS/CloudFront",
        metricName,
        dimensionsMap: { DistributionId: dist.distributionId, Region: "Global" },
        statistic: "Average",
        period: Duration.minutes(1),
      });
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.recommendedAlarms(false).addAlarms({
        clientErrors: (alarm) => alarm.metric(distMetric("4xxErrorRate")).threshold(5),
        serverErrors: (alarm) => alarm.metric(distMetric("5xxErrorRate")).threshold(1),
      });
    });

    expect(Object.keys(result.alarms)).toEqual(["clientErrors", "serverErrors"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  const code = FunctionCode.fromInline("function handler(event) { return event.request; }");

  function withFunctions(b: ReturnType<typeof createDistributionBuilder>, stack: Stack) {
    withOrigin(b, stack);
    b.defaultBehavior({ functions: [{ eventType: FunctionEventType.VIEWER_REQUEST, code }] });
    b.behavior("/api/*", {
      origin: new HttpOrigin("api.example.com"),
      functions: [{ eventType: FunctionEventType.VIEWER_RESPONSE, code }],
    });
  }

  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth(withOrigin);
    const typed: DistributionBuilderResult = result;
    const errorRate = typed.alarms.errorRate;

    assertAssignable<Alarm | undefined, typeof errorRate>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof errorRate>();
    expect(errorRate).toBeDefined();
    // @ts-expect-error -- "errorRat" is not a CloudFront alarm key
    expect(typed.alarms.errorRat).toBeUndefined();
  });

  it("types behavior function alarm keys by scope, event type and suffix", () => {
    const { result } = buildAndSynth(withFunctions);
    const typed: DistributionBuilderResult = result;

    assertAssignable<
      Alarm | undefined,
      typeof typed.alarms.defaultBehaviorViewerRequestThrottles
    >();
    expect(typed.alarms.defaultBehaviorViewerRequestThrottles).toBeDefined();
    expect(typed.alarms.behaviorApiSlashStarViewerResponseExecutionErrors).toBeDefined();
    expect(typed.alarms.behaviorApiSlashStarViewerResponseValidationErrors).toBeDefined();
    // @ts-expect-error -- the suffix is "Throttles", not "Throttle"
    expect(typed.alarms.defaultBehaviorViewerRequestThrottle).toBeUndefined();
    // @ts-expect-error -- "ViewRequest" is not a CloudFront Function event type
    expect(typed.alarms.defaultBehaviorViewRequestThrottles).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.addAlarm("clientErrors", (alarm) =>
        alarm
          .metric(
            (dist) =>
              new Metric({
                namespace: "AWS/CloudFront",
                metricName: "4xxErrorRate",
                dimensionsMap: { DistributionId: dist.distributionId, Region: "Global" },
              }),
          )
          .threshold(10),
      );
    });
    const alarm = ref("cdn", (r: WithCustomAlarms<DistributionBuilderResult, "clientErrors">) => {
      // @ts-expect-error -- "clientError" was not declared as a custom key
      expect(r.alarms.clientError).toBeUndefined();
      return r.alarms.clientErrors;
    }).resolve({ cdn: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.clientErrors);
  });
});
