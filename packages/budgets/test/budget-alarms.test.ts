import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { type CfnBudget } from "aws-cdk-lib/aws-budgets";
import type { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createBudgetBuilder } from "../src/budget-builder.js";

const ENV_US_EAST_1 = { account: "123456789012", region: "us-east-1" };
const ENV_EU_WEST_1 = { account: "123456789012", region: "eu-west-1" };

interface Env {
  account: string;
  region: string;
}
const ENV_AGNOSTIC = "agnostic" as const;

function buildResult(
  configureFn?: (builder: ReturnType<typeof createBudgetBuilder>) => void,
  env: Env | typeof ENV_AGNOSTIC = ENV_US_EAST_1,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack", env === ENV_AGNOSTIC ? undefined : { env });
  const builder = createBudgetBuilder().budgetName("Account").limit({ amount: 1000 });
  configureFn?.(builder);
  const result = builder.build(stack, "AccountBudget");
  return { app, stack, result, template: Template.fromStack(stack) };
}

function customCpuAlarm(a: AlarmDefinitionBuilder<CfnBudget>) {
  return a
    .metric(
      () =>
        new Metric({
          namespace: "AWS/Billing",
          metricName: "EstimatedCharges",
          dimensionsMap: { Currency: "USD", ServiceName: "AmazonEC2" },
          statistic: "Maximum",
        }),
    )
    .threshold(500)
    .greaterThan()
    .description("EC2 estimated charges exceeded $500.");
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates no alarms when recommendedAlarms is not configured", () => {
      const { result, template } = buildResult();

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates the EstimatedCharges alarm when opted in", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ estimatedCharges: { threshold: 50 } });
      });

      expect(result.alarms.estimatedCharges).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates EstimatedCharges with AWS-recommended metric shape", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ estimatedCharges: { threshold: 50 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "EstimatedCharges",
        Namespace: "AWS/Billing",
        Threshold: 50,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        Statistic: "Maximum",
        Period: 21600,
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "Currency", Value: "USD" })]),
      });
    });

    it("includes threshold and currency in the alarm description", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ estimatedCharges: { threshold: 50, currency: "GBP" } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmDescription: Match.stringLikeRegexp("estimated charges exceeded 50 GBP"),
      });
    });
  });

  describe("customisation", () => {
    it("honours a custom currency dimension", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ estimatedCharges: { threshold: 25, currency: "GBP" } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "Currency", Value: "GBP" })]),
      });
    });

    it("honours custom evaluation/datapoints overrides", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({
          estimatedCharges: { threshold: 100, evaluationPeriods: 3, datapointsToAlarm: 2 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });
  });

  describe("disabling", () => {
    it("recommendedAlarms(false) suppresses the recommended alarm", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("recommendedAlarms({ enabled: false }) suppresses the recommended alarm", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({
          enabled: false,
          estimatedCharges: { threshold: 50 },
        });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("estimatedCharges: false suppresses just the recommended alarm", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ enabled: true, estimatedCharges: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("custom alarms via addAlarm", () => {
    it("creates a custom alarm even when recommended alarms are disabled", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms(false).addAlarm("ec2EstimatedCharges", customCpuAlarm);
      });

      expect(result.alarms.ec2EstimatedCharges).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Dimensions: Match.arrayWith([
          Match.objectLike({ Name: "ServiceName", Value: "AmazonEC2" }),
        ]),
        Threshold: 500,
      });
    });

    it("creates custom alarms alongside recommended alarms", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ estimatedCharges: { threshold: 1000 } }).addAlarm(
          "ec2EstimatedCharges",
          customCpuAlarm,
        );
      });

      expect(result.alarms.estimatedCharges).toBeDefined();
      expect(result.alarms.ec2EstimatedCharges).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });
  });

  describe("region warning", () => {
    it("emits a warning when alarms would be created outside us-east-1", () => {
      const { stack } = buildResult(
        (b) => b.recommendedAlarms({ estimatedCharges: { threshold: 50 } }),
        ENV_EU_WEST_1,
      );

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "eu-west-1"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("emits no warning in us-east-1", () => {
      const { stack } = buildResult((b) =>
        b.recommendedAlarms({ estimatedCharges: { threshold: 50 } }),
      );

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when the stack region is an unresolved token", () => {
      const { stack } = buildResult(
        (b) => b.recommendedAlarms({ estimatedCharges: { threshold: 50 } }),
        ENV_AGNOSTIC,
      );

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when no alarms are created (alarms disabled, no custom alarms)", () => {
      const { stack } = buildResult(undefined, ENV_EU_WEST_1);

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("AWS/Billing EstimatedCharges"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("warns on the custom-alarm-only path outside us-east-1", () => {
      const { stack } = buildResult(
        (b) => b.recommendedAlarms(false).addAlarm("ec2EstimatedCharges", customCpuAlarm),
        ENV_EU_WEST_1,
      );

      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "eu-west-1"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
