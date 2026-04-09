import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
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
