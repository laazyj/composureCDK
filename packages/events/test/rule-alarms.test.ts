import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { createRuleBuilder } from "../src/rule-builder.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack");
}

function makeFn(stack: Stack): LambdaFn {
  return new LambdaFn(stack, "Handler", {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {};"),
  });
}

describe("RuleBuilder recommended alarms", () => {
  it("creates the four AWS-recommended alarms by default", () => {
    const stack = newStack();
    const fn = makeFn(stack);

    const result = createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget("h", new LambdaFunction(fn))
      .build(stack, "TestRule");

    expect(Object.keys(result.alarms).sort()).toEqual([
      "failedInvocations",
      "invocationsFailedToBeSentToDlq",
      "invocationsSentToDlq",
      "throttledRules",
    ]);

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
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
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "InvocationsSentToDlq",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "InvocationsFailedToBeSentToDlq",
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
      "invocationsFailedToBeSentToDlq",
      "invocationsSentToDlq",
      "retryAttempts",
      "throttledRules",
    ]);
    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "RetryInvocationAttempts",
      Threshold: 10,
    });
  });
});
