import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { createTableBuilder } from "../src/table-builder.js";

const PK = { name: "pk", type: AttributeType.STRING };

function build(configureFn?: (builder: ReturnType<typeof createTableBuilder>) => void): {
  result: ReturnType<ReturnType<typeof createTableBuilder>["build"]>;
  template: Template;
} {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createTableBuilder().partitionKey(PK);
  configureFn?.(builder);
  const result = builder.build(stack, "TestTable");
  return { result, template: Template.fromStack(stack) };
}

describe("table alarms", () => {
  describe("recommended alarms", () => {
    it("creates the three recommended alarms by default", () => {
      const { result, template } = build();

      expect(Object.keys(result.alarms).sort()).toEqual([
        "readThrottleEvents",
        "systemErrors",
        "writeThrottleEvents",
      ]);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("alarms on read throttle events with a > 0 threshold", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ReadThrottleEvents",
        Namespace: "AWS/DynamoDB",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    it("alarms on write throttle events with a > 0 threshold", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "WriteThrottleEvents",
        Namespace: "AWS/DynamoDB",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    it("alarms on system errors via a math expression across operations", () => {
      const { template } = build();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Metrics: Match.arrayWith([Match.objectLike({ Expression: Match.anyValue() })]),
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });
  });

  describe("customizing and disabling", () => {
    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = build((b) => b.recommendedAlarms(false));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all recommended alarms when enabled is false", () => {
      const { result } = build((b) => b.recommendedAlarms({ enabled: false }));

      expect(Object.keys(result.alarms)).toHaveLength(0);
    });

    it("disables an individual alarm", () => {
      const { result } = build((b) => b.recommendedAlarms({ writeThrottleEvents: false }));

      expect(Object.keys(result.alarms).sort()).toEqual(["readThrottleEvents", "systemErrors"]);
    });

    it("overrides an individual alarm threshold", () => {
      const { template } = build((b) =>
        b.recommendedAlarms({ readThrottleEvents: { threshold: 10, evaluationPeriods: 3 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ReadThrottleEvents",
        Threshold: 10,
        EvaluationPeriods: 3,
      });
    });
  });

  describe("custom alarms", () => {
    it("creates a custom alarm alongside the recommended ones", () => {
      const { result, template } = build((b) =>
        b.addAlarm("userErrors", (a) =>
          a
            .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
            .threshold(5)
            .greaterThan()
            .description("Table is returning client-side (HTTP 400) errors."),
        ),
      );

      expect(result.alarms.userErrors).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "UserErrors",
        Namespace: "AWS/DynamoDB",
        Threshold: 5,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });
  });
});
