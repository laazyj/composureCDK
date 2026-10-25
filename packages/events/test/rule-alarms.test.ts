import { describe, it, expect } from "vitest";
import { Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { newStack } from "@composurecdk/cdk-testing";
import type { RuleAlarmConfig } from "../src/rule-alarm-config.js";
import { resolveRuleAlarmDefinitions } from "../src/rule-alarms.js";
import { createRuleBuilder } from "../src/rule-builder.js";

function makeFn(stack: Stack): LambdaFn {
  return new LambdaFn(stack, "Handler", {
    runtime: Runtime.PROVIDED_AL2,
    handler: "bootstrap",
    code: Code.fromAsset("test/fixtures/lambda"),
  });
}

describe("RuleBuilder recommended alarms", () => {
  it("creates the two non-DLQ recommended alarms by default", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .build(stack, "TestRule");

    expect(Object.keys(result.alarms).sort()).toEqual(["failedInvocations", "throttledRules"]);

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FailedInvocations",
      Namespace: "AWS/Events",
      Statistic: "Sum",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ThrottledRules",
    });
  });

  describe("DLQ alarms", () => {
    function buildRule(withDlq: boolean, recommendedAlarms?: RuleAlarmConfig) {
      const stack = newStack();
      const fn = makeFn(stack);
      const deadLetterQueue = withDlq ? new Queue(stack, "Dlq") : undefined;

      const result = createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .addTarget("h", new LambdaFunction(fn, { deadLetterQueue }))
        .recommendedAlarms(recommendedAlarms)
        .build(stack, "TestRule");

      return { alarmKeys: Object.keys(result.alarms).sort(), template: Template.fromStack(stack) };
    }

    it("creates both DLQ alarms when a target has a dead-letter queue", () => {
      const { alarmKeys, template } = buildRule(true);

      expect(alarmKeys).toEqual([
        "failedInvocations",
        "invocationsFailedToBeSentToDlq",
        "invocationsSentToDlq",
        "throttledRules",
      ]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "InvocationsSentToDlq",
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "InvocationsFailedToBeSentToDlq",
      });
    });

    it("creates a DLQ alarm without a target DLQ when its config is explicit", () => {
      const { alarmKeys, template } = buildRule(false, { invocationsSentToDlq: { threshold: 2 } });

      expect(alarmKeys).toEqual(["failedInvocations", "invocationsSentToDlq", "throttledRules"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "InvocationsSentToDlq",
        Threshold: 2,
      });
    });

    it("keeps the DLQ alarms off when tuning another alarm on a rule without a DLQ", () => {
      const { alarmKeys } = buildRule(false, { failedInvocations: { threshold: 5 } });

      expect(alarmKeys).toEqual(["failedInvocations", "throttledRules"]);
    });

    it("leaves the DLQ alarms off by default for an imported rule, which has no L1 to read", () => {
      const rule = Rule.fromEventRuleArn(
        newStack(),
        "Imported",
        "arn:aws:events:us-east-1:123456789012:rule/imported",
      );

      const keys = resolveRuleAlarmDefinitions(rule, undefined).map((d) => d.key);

      expect(keys).toEqual(["failedInvocations", "throttledRules"]);
    });

    it("disables a DLQ alarm set to false even when a target has a DLQ", () => {
      const { alarmKeys } = buildRule(true, { invocationsFailedToBeSentToDlq: false });

      expect(alarmKeys).toEqual(["failedInvocations", "invocationsSentToDlq", "throttledRules"]);
    });
  });

  it("dimensions every alarm by RuleName", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .build(stack, "TestRule");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: Match.arrayWith([
        Match.objectLike({ Name: "RuleName", Value: Match.anyValue() }),
      ]),
    });
  });

  it("disables all recommended alarms when recommendedAlarms is false", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .recommendedAlarms(false)
      .build(stack, "TestRule");

    expect(result.alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("disables individual alarms when set to false", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .recommendedAlarms({
        throttledRules: false,
        invocationsSentToDlq: false,
        invocationsFailedToBeSentToDlq: false,
      })
      .build(stack, "TestRule");

    expect(Object.keys(result.alarms)).toEqual(["failedInvocations"]);
  });

  it("emits actionable alarm descriptions including the threshold", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .build(stack, "TestRule");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FailedInvocations",
      AlarmDescription: Match.stringLikeRegexp("failing to invoke targets.*Threshold: > 0"),
    });
  });

  it("layers user overrides onto defaults without replacing other fields", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .recommendedAlarms({
        failedInvocations: { threshold: 5, evaluationPeriods: 3 },
      })
      .build(stack, "TestRule");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FailedInvocations",
      Threshold: 5,
      EvaluationPeriods: 3,
      // datapointsToAlarm and treatMissingData should still come from defaults
      DatapointsToAlarm: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("supports addAlarm for custom rule alarms", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .addAlarm("retryAttempts", (alarm) =>
        alarm
          .metric(
            (rule) =>
              new Metric({
                namespace: "AWS/Events",
                metricName: "RetryInvocationAttempts",
                dimensionsMap: { RuleName: rule.ruleName },
                statistic: "Sum",
                period: Duration.minutes(1),
              }),
          )
          .threshold(10)
          .greaterThan()
          .description("Targets are being undersized; retries are climbing."),
      )
      .build(stack, "TestRule");

    expect(Object.keys(result.alarms).sort()).toEqual([
      "failedInvocations",
      "retryAttempts",
      "throttledRules",
    ]);
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "RetryInvocationAttempts",
      Threshold: 10,
    });
  });

  // Regression: disabling the recommended alarms must not drop custom alarms
  // added via addAlarm() — see issue #305.
  function buildWithCustomAlarm(disable: false | { enabled: false }) {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .recommendedAlarms(disable)
      .addAlarm("retryAttempts", (alarm) =>
        alarm
          .metric(
            (rule) =>
              new Metric({
                namespace: "AWS/Events",
                metricName: "RetryInvocationAttempts",
                dimensionsMap: { RuleName: rule.ruleName },
                statistic: "Sum",
                period: Duration.minutes(1),
              }),
          )
          .threshold(10)
          .greaterThan()
          .description("Targets are being undersized; retries are climbing."),
      )
      .build(stack, "TestRule");

    return { result, template: Template.fromStack(stack) };
  }

  it("keeps a custom alarm when recommendedAlarms is false", () => {
    const { result, template } = buildWithCustomAlarm(false);

    expect(Object.keys(result.alarms)).toEqual(["retryAttempts"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildWithCustomAlarm({ enabled: false });

    expect(Object.keys(result.alarms)).toEqual(["retryAttempts"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});
