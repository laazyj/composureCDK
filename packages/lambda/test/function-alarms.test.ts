import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { alarmName } from "@composurecdk/cloudwatch";
import type { FunctionAlarmConfig } from "../src/alarm-config.js";
import { createFunctionBuilder } from "../src/function-builder.js";

function buildResult(configureFn: (builder: ReturnType<typeof createFunctionBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createFunctionBuilder();
  configureFn(builder);
  const result = builder.build(stack, "TestFunction");
  return { result, template: Template.fromStack(stack) };
}

function minimalFunction(builder: ReturnType<typeof createFunctionBuilder>) {
  builder
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates errors and throttles alarms by default", () => {
      const { result, template } = buildResult(minimalFunction);

      expect(result.alarms.errors).toBeDefined();
      expect(result.alarms.throttles).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("does not create duration alarm without timeout", () => {
      const { result } = buildResult(minimalFunction);

      expect(result.alarms.duration).toBeUndefined();
    });

    it("does not create concurrentExecutions alarm without reservedConcurrentExecutions", () => {
      const { result } = buildResult(minimalFunction);

      expect(result.alarms.concurrentExecutions).toBeUndefined();
    });

    it("creates errors alarm with threshold > 0", () => {
      const { template } = buildResult(minimalFunction);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("creates throttles alarm with threshold > 0", () => {
      const { template } = buildResult(minimalFunction);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Throttles",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult(minimalFunction);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 0 errors"),
      });
    });
  });

  describe("contextual alarms", () => {
    it("creates duration alarm when timeout is configured", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30));
      });

      expect(result.alarms.duration).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Duration",
        Threshold: 27000, // 90% of 30s = 27s = 27000ms
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        ExtendedStatistic: "p99",
        Period: 60,
      });
    });

    it("creates concurrentExecutions alarm when reservedConcurrentExecutions is set", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.reservedConcurrentExecutions(100);
      });

      expect(result.alarms.concurrentExecutions).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ConcurrentExecutions",
        Threshold: 80, // 80% of 100
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
      });
    });

    it("creates all four alarms when both timeout and reservedConcurrentExecutions are set", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30)).reservedConcurrentExecutions(100);
      });

      expect(result.alarms.errors).toBeDefined();
      expect(result.alarms.throttles).toBeDefined();
      expect(result.alarms.duration).toBeDefined();
      expect(result.alarms.concurrentExecutions).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    });
  });

  describe("token-valued props", () => {
    // A timeout threaded through a CfnParameter is an unresolved token: the
    // duration alarm cannot derive a millisecond threshold from it. build()
    // must still succeed (the conversion previously threw — see #196), the
    // alarm must be omitted, and a warning must explain the skip.
    function buildWithTokenTimeout(config?: FunctionAlarmConfig | false) {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const param = new CfnParameter(stack, "TimeoutSeconds", { type: "Number", default: 30 });
      const builder = createFunctionBuilder();
      minimalFunction(builder);
      builder.timeout(Duration.seconds(param.valueAsNumber));
      if (config !== undefined) builder.recommendedAlarms(config);
      const result = builder.build(stack, "TestFunction");
      return { result, stack };
    }

    it("builds successfully and omits the duration alarm for a token-valued timeout", () => {
      const { result } = buildWithTokenTimeout();

      expect(result.alarms.duration).toBeUndefined();
      expect(result.alarms.errors).toBeDefined();
      expect(result.alarms.throttles).toBeDefined();
    });

    it("warns when the duration alarm is skipped for a token-valued timeout", () => {
      const { stack } = buildWithTokenTimeout();

      // The ack tag is the public suppression handle, so it is asserted here to
      // guard against an accidental rename.
      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp(
          "Skipping the recommended Lambda duration alarm.*" +
            "\\[ack: @composurecdk/lambda:token-timeout-duration-alarm\\]",
        ),
      );
    });

    it("does not warn when duration is disabled, even with a token-valued timeout", () => {
      // recommendedAlarms({ duration: false }) must short-circuit before the
      // token is inspected, so it is a reliable escape hatch.
      const { result, stack } = buildWithTokenTimeout({ duration: false });

      expect(result.alarms.duration).toBeUndefined();
      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
    });

    function buildWithTokenConcurrency(config?: FunctionAlarmConfig | false) {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const param = new CfnParameter(stack, "Concurrency", { type: "Number", default: 100 });
      const builder = createFunctionBuilder();
      minimalFunction(builder);
      builder.reservedConcurrentExecutions(param.valueAsNumber);
      if (config !== undefined) builder.recommendedAlarms(config);
      const result = builder.build(stack, "TestFunction");
      return { result, stack };
    }

    it("omits the concurrentExecutions alarm for a token-valued reservedConcurrentExecutions", () => {
      // A token value would not throw but would silently round to a garbage
      // threshold, so the alarm is skipped rather than rendered wrong.
      const { result, stack } = buildWithTokenConcurrency();

      expect(result.alarms.concurrentExecutions).toBeUndefined();
      Annotations.fromStack(stack).hasWarning(
        "*",
        Match.stringLikeRegexp(
          "Skipping the recommended Lambda concurrent-executions alarm.*" +
            "\\[ack: @composurecdk/lambda:token-reserved-concurrency-alarm\\]",
        ),
      );
    });

    it("does not warn when concurrentExecutions is disabled, even with a token value", () => {
      const { result, stack } = buildWithTokenConcurrency({ concurrentExecutions: false });

      expect(result.alarms.concurrentExecutions).toBeUndefined();
      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
    });
  });

  describe("customization", () => {
    it("allows customizing errors alarm threshold", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ errors: { threshold: 5 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        Threshold: 5,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ throttles: { evaluationPeriods: 5, datapointsToAlarm: 3 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Throttles",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
      });
    });

    it("allows overriding alarmName on a recommended alarm", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ errors: { alarmName: alarmName("checkout-fn-errors") } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        AlarmName: "checkout-fn-errors",
      });
    });

    it("derives a default AlarmName when not overridden", () => {
      const { template } = buildResult(minimalFunction);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        AlarmName: "test-stack/test-function/errors",
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ errors: { treatMissingData: TreatMissingData.BREACHING } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        TreatMissingData: "breaching",
      });
    });

    it("allows overriding the duration alarm threshold percent", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30)).recommendedAlarms({
          duration: { thresholdPercent: 0.75 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Duration",
        Threshold: 22500, // 75% of 30s = 22.5s = 22500ms
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30)).reservedConcurrentExecutions(100).recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.recommendedAlarms({ errors: false });
      });

      expect(result.alarms.errors).toBeUndefined();
      expect(result.alarms.throttles).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30)).recommendedAlarms({
          errors: false,
          throttles: false,
        });
      });

      expect(result.alarms.errors).toBeUndefined();
      expect(result.alarms.throttles).toBeUndefined();
      expect(result.alarms.duration).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });
  });

  describe("validation", () => {
    it("throws when thresholdPercent is 0", () => {
      expect(() =>
        buildResult((b) => {
          minimalFunction(b);
          b.timeout(Duration.seconds(30)).recommendedAlarms({
            duration: { thresholdPercent: 0 },
          });
        }),
      ).toThrow(/thresholdPercent must be between 0 \(exclusive\) and 1 \(inclusive\)/);
    });

    it("throws when thresholdPercent is negative", () => {
      expect(() =>
        buildResult((b) => {
          minimalFunction(b);
          b.timeout(Duration.seconds(30)).recommendedAlarms({
            duration: { thresholdPercent: -0.5 },
          });
        }),
      ).toThrow(/thresholdPercent must be between 0 \(exclusive\) and 1 \(inclusive\)/);
    });

    it("throws when thresholdPercent exceeds 1", () => {
      expect(() =>
        buildResult((b) => {
          minimalFunction(b);
          b.timeout(Duration.seconds(30)).recommendedAlarms({
            duration: { thresholdPercent: 1.5 },
          });
        }),
      ).toThrow(/thresholdPercent must be between 0 \(exclusive\) and 1 \(inclusive\)/);
    });

    it("allows thresholdPercent of exactly 1", () => {
      const { template } = buildResult((b) => {
        minimalFunction(b);
        b.timeout(Duration.seconds(30)).recommendedAlarms({
          duration: { thresholdPercent: 1 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Duration",
        Threshold: 30000, // 100% of 30s
      });
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult(minimalFunction);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "Errors",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b) => {
      minimalFunction(b);
      b.addAlarm("invocations", (alarm) =>
        alarm
          .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
          .threshold(1000)
          .greaterThanOrEqual()
          .description("High invocation count"),
      );
    });

    expect(result.alarms.errors).toBeDefined();
    expect(result.alarms.throttles).toBeDefined();
    expect(result.alarms.invocations).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Invocations",
      Threshold: 1000,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmDescription: "High invocation count",
    });
  });

  it("creates a custom alarm with all builder options", () => {
    const { template } = buildResult((b) => {
      minimalFunction(b);
      b.addAlarm("customMetric", (alarm) =>
        alarm
          .metric((fn) => fn.metricErrors({ period: Duration.minutes(5) }))
          .threshold(50)
          .greaterThan()
          .evaluationPeriods(5)
          .datapointsToAlarm(3)
          .treatMissingData(TreatMissingData.BREACHING)
          .description("Custom metric alarm"),
      );
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 50,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 5,
      DatapointsToAlarm: 3,
      TreatMissingData: "breaching",
      AlarmDescription: "Custom metric alarm",
    });
  });

  it("supports multiple custom alarms", () => {
    const { result, template } = buildResult((b) => {
      minimalFunction(b);
      b.addAlarm("highInvocations", (alarm) =>
        alarm
          .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
          .threshold(1000)
          .description("High invocations"),
      ).addAlarm("lowInvocations", (alarm) =>
        alarm
          .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
          .threshold(0)
          .lessThanOrEqual()
          .description("No invocations"),
      );
    });

    expect(result.alarms.highInvocations).toBeDefined();
    expect(result.alarms.lowInvocations).toBeDefined();
    // 2 recommended (errors, throttles) + 2 custom
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
  });

  it("propagates alarmName from .addAlarm to the rendered alarm", () => {
    const { template } = buildResult((b) => {
      minimalFunction(b);
      b.addAlarm("invocations", (alarm) =>
        alarm
          .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
          .alarmName(alarmName("checkout-fn-invocations"))
          .threshold(1),
      );
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "checkout-fn-invocations",
    });
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildResult((b) => {
        minimalFunction(b);
        b.addAlarm("errors", (alarm) =>
          alarm
            .metric((fn) => fn.metricErrors({ period: Duration.minutes(1) }))
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "errors"/);
  });
});
