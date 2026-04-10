import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { createTopicBuilder } from "../src/topic-builder.js";

function buildResult(configureFn?: (builder: ReturnType<typeof createTopicBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createTopicBuilder();
  configureFn?.(builder);
  const result = builder.build(stack, "TestTopic");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates numberOfNotificationsFailed and numberOfNotificationsFilteredOutInvalidAttributes alarms by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.numberOfNotificationsFailed).toBeDefined();
      expect(result.alarms.numberOfNotificationsFilteredOutInvalidAttributes).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates numberOfNotificationsFailed alarm with threshold > 0", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        Namespace: "AWS/SNS",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("creates numberOfNotificationsFilteredOutInvalidAttributes alarm with threshold > 0", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFilteredOut-InvalidAttributes",
        Namespace: "AWS/SNS",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
      });
    });

    it("includes TopicName dimension", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "TopicName" })]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 0"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing numberOfNotificationsFailed alarm threshold", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ numberOfNotificationsFailed: { threshold: 5 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        Threshold: 5,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({
          numberOfNotificationsFailed: { evaluationPeriods: 3, datapointsToAlarm: 2 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({
          numberOfNotificationsFailed: { treatMissingData: TreatMissingData.BREACHING },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ numberOfNotificationsFailed: false });
      });

      expect(result.alarms.numberOfNotificationsFailed).toBeUndefined();
      expect(result.alarms.numberOfNotificationsFilteredOutInvalidAttributes).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({
          numberOfNotificationsFailed: false,
          numberOfNotificationsFilteredOutInvalidAttributes: false,
        });
      });

      expect(result.alarms.numberOfNotificationsFailed).toBeUndefined();
      expect(result.alarms.numberOfNotificationsFilteredOutInvalidAttributes).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailed",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildResult((b) => {
      b.addAlarm("numberOfMessagesPublished", (alarm) =>
        alarm
          .metric(
            (topic) =>
              new Metric({
                namespace: "AWS/SNS",
                metricName: "NumberOfMessagesPublished",
                dimensionsMap: { TopicName: topic.topicName },
                statistic: "Sum",
                period: Duration.minutes(1),
              }),
          )
          .threshold(10000)
          .greaterThanOrEqual()
          .description("Topic receiving unusually high message volume"),
      );
    });

    expect(result.alarms.numberOfNotificationsFailed).toBeDefined();
    expect(result.alarms.numberOfNotificationsFilteredOutInvalidAttributes).toBeDefined();
    expect(result.alarms.numberOfMessagesPublished).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildResult((b) => {
        b.addAlarm("numberOfNotificationsFailed", (alarm) =>
          alarm
            .metric(
              (topic) =>
                new Metric({
                  namespace: "AWS/SNS",
                  metricName: "NumberOfNotificationsFailed",
                  dimensionsMap: { TopicName: topic.topicName },
                  period: Duration.minutes(1),
                }),
            )
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "numberOfNotificationsFailed"/);
  });
});
