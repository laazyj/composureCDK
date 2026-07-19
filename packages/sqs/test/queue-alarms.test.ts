import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { createQueueBuilder } from "../src/queue-builder.js";
import { resolveQueueAlarmDefinitions } from "../src/queue-alarms.js";
import { PRIMARY_ALARM_PROFILE } from "../src/queue-alarm-profiles.js";

function buildResult(configureFn?: (builder: ReturnType<typeof createQueueBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createQueueBuilder();
  configureFn?.(builder);
  const result = builder.build(stack, "TestQueue");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates both recommended alarms by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.approximateAgeOfOldestMessage).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates approximateAgeOfOldestMessage alarm with threshold > 300 seconds", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Namespace: "AWS/SQS",
        Threshold: 300,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Maximum",
        Period: 60,
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "QueueName" })]),
      });
    });

    it("creates approximateNumberOfMessagesNotVisible alarm with threshold > 90000", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesNotVisible",
        Namespace: "AWS/SQS",
        Threshold: 90_000,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Maximum",
        Period: 60,
      });
    });
  });

  describe("customisation", () => {
    it("allows overriding the approximateAgeOfOldestMessage threshold", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ approximateAgeOfOldestMessage: { threshold: 60 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: 60,
      });
    });

    it("allows overriding evaluationPeriods and treatMissingData", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({
          approximateAgeOfOldestMessage: {
            evaluationPeriods: 3,
            treatMissingData: TreatMissingData.MISSING,
          },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        EvaluationPeriods: 3,
        TreatMissingData: "missing",
      });
    });

    it("disables an individual alarm when set to false", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesNotVisible: false }),
      );

      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms(false));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all recommended alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms({ enabled: false }));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates approximateNumberOfMessagesVisible when opted in with an explicit threshold", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesVisible: { threshold: 1000 } }),
      );

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesVisible",
        Threshold: 1000,
      });
    });

    it("throws when approximateNumberOfMessagesVisible is opted in without a threshold", () => {
      // No generic visible-messages threshold fits a primary queue, so the
      // opt-in must bring its own instead of silently inheriting a noisy 0.
      expect(() =>
        buildResult((b) => b.recommendedAlarms({ approximateNumberOfMessagesVisible: {} })),
      ).toThrow(/"approximateNumberOfMessagesVisible" alarm has no generic default threshold/);
    });
  });

  describe("no default actions", () => {
    it("creates recommended alarms with no AlarmActions configured", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        AlarmActions: Match.absent(),
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesNotVisible",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm duplicate-key safety", () => {
  it("throws when a custom alarm reuses a recommended-alarm key", () => {
    expect(() =>
      buildResult((b) => {
        b.addAlarm("approximateAgeOfOldestMessage", (alarm) =>
          alarm
            .metric((queue) => queue.metricApproximateAgeOfOldestMessage())
            .threshold(1)
            .greaterThan()
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "approximateAgeOfOldestMessage"/);
  });
});

// Regression: disabling the recommended alarms must not drop custom alarms
// added via addAlarm() — see issue #305.
describe("custom alarms survive disabled recommended alarms", () => {
  function customAlarm(builder: ReturnType<typeof createQueueBuilder>) {
    return builder.addAlarm("backlogDepth", (alarm) =>
      alarm
        .metric((queue) => queue.metricApproximateNumberOfMessagesVisible())
        .threshold(1000)
        .greaterThan()
        .description("Queue backlog is deep"),
    );
  }

  it("keeps a custom alarm when recommendedAlarms is false", () => {
    const { result, template } = buildResult((b) => {
      customAlarm(b.recommendedAlarms(false));
    });

    expect(result.alarms.backlogDepth).toBeDefined();
    expect(Object.keys(result.alarms)).toEqual(["backlogDepth"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildResult((b) => {
      customAlarm(b.recommendedAlarms({ enabled: false }));
    });

    expect(result.alarms.backlogDepth).toBeDefined();
    expect(Object.keys(result.alarms)).toEqual(["backlogDepth"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});

describe("resolveQueueAlarmDefinitions", () => {
  it("returns no definitions when explicitly disabled", () => {
    const stack = new Stack(new App(), "TestStack");
    const queue = new Queue(stack, "Queue");

    expect(resolveQueueAlarmDefinitions(queue, { enabled: false }, PRIMARY_ALARM_PROFILE)).toEqual(
      [],
    );
  });
});
