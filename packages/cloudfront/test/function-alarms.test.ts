import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { FunctionCode } from "aws-cdk-lib/aws-cloudfront";
import { createFunctionBuilder } from "../src/function-builder.js";

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

function buildResult(
  configureFn: (builder: ReturnType<typeof createFunctionBuilder>, stack: Stack) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createFunctionBuilder();
  configureFn(builder, stack);
  const result = builder.build(stack, "TestFunction");
  return { result, template: Template.fromStack(stack) };
}

function withCode(builder: ReturnType<typeof createFunctionBuilder>) {
  builder.code(FunctionCode.fromInline(INLINE_CODE));
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates executionErrors, validationErrors and throttles alarms by default", () => {
      const { result, template } = buildResult((b) => {
        withCode(b);
      });

      expect(result.alarms.executionErrors).toBeDefined();
      expect(result.alarms.validationErrors).toBeDefined();
      expect(result.alarms.throttles).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("creates executionErrors alarm with threshold > 0", () => {
      const { template } = buildResult((b) => {
        withCode(b);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionExecutionErrors",
        Namespace: "AWS/CloudFront",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        Statistic: "Sum",
        Period: 60,
        TreatMissingData: "notBreaching",
      });
    });

    it("creates validationErrors alarm with threshold > 0", () => {
      const { template } = buildResult((b) => {
        withCode(b);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionValidationErrors",
        Namespace: "AWS/CloudFront",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("creates throttles alarm with threshold > 0", () => {
      const { template } = buildResult((b) => {
        withCode(b);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionThrottles",
        Namespace: "AWS/CloudFront",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        Statistic: "Sum",
      });
    });

    it("includes FunctionName and Region=Global dimensions", () => {
      const { template } = buildResult((b) => {
        withCode(b);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionExecutionErrors",
        Dimensions: Match.arrayWith([
          Match.objectLike({ Name: "FunctionName" }),
          Match.objectLike({ Name: "Region", Value: "Global" }),
        ]),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing executionErrors threshold", () => {
      const { template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms({ executionErrors: { threshold: 5 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionExecutionErrors",
        Threshold: 5,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms({
          throttles: { evaluationPeriods: 3, datapointsToAlarm: 2 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionThrottles",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });

    it("allows customizing treatMissingData", () => {
      const { template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms({
          validationErrors: { treatMissingData: TreatMissingData.BREACHING },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionValidationErrors",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) => {
        withCode(b);
        b.recommendedAlarms({ executionErrors: false });
      });

      expect(result.alarms.executionErrors).toBeUndefined();
      expect(result.alarms.validationErrors).toBeDefined();
      expect(result.alarms.throttles).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult((b) => {
        withCode(b);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "FunctionExecutionErrors",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b) => {
      withCode(b);
      b.addAlarm("computeUtilization", (alarm) =>
        alarm
          .metric(
            (fn) =>
              new Metric({
                namespace: "AWS/CloudFront",
                metricName: "FunctionComputeUtilization",
                dimensionsMap: {
                  FunctionName: fn.functionName,
                  Region: "Global",
                },
                statistic: "Average",
                period: Duration.minutes(1),
              }),
          )
          .threshold(80)
          .greaterThan()
          .description("CloudFront function compute utilization is high"),
      );
    });

    expect(result.alarms.computeUtilization).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionComputeUtilization",
      Threshold: 80,
    });
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildResult((b) => {
        withCode(b);
        b.addAlarm("executionErrors", (alarm) =>
          alarm
            .metric(
              (fn) =>
                new Metric({
                  namespace: "AWS/CloudFront",
                  metricName: "FunctionExecutionErrors",
                  dimensionsMap: {
                    FunctionName: fn.functionName,
                    Region: "Global",
                  },
                  period: Duration.minutes(1),
                }),
            )
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "executionErrors"/);
  });
});
