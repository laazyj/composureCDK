import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SubscriptionProtocol, Topic } from "aws-cdk-lib/aws-sns";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { createSubscriptionBuilder } from "../src/subscription-builder.js";

function buildResult(
  configureFn?: (
    builder: ReturnType<typeof createSubscriptionBuilder>,
    topic: Topic,
    stack: Stack,
  ) => void,
  { attachDlq = true }: { attachDlq?: boolean } = {},
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const topic = new Topic(stack, "Topic");
  const builder = createSubscriptionBuilder()
    .topic(topic)
    .protocol(SubscriptionProtocol.EMAIL)
    .endpoint("ops@example.com");

  if (attachDlq) {
    const dlq = new Queue(stack, "Dlq");
    builder.deadLetterQueue(dlq);
  }

  configureFn?.(builder, topic, stack);
  const result = builder.build(stack, "Sub");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended subscription alarms", () => {
  describe("with a DLQ attached", () => {
    it("creates both recommended alarms by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.numberOfNotificationsRedrivenToDlq).toBeDefined();
      expect(result.alarms.numberOfNotificationsFailedToRedriveToDlq).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates NumberOfNotificationsRedrivenToDlq alarm with threshold > 0", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        Namespace: "AWS/SNS",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 60,
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "TopicName" })]),
      });
    });

    it("creates NumberOfNotificationsFailedToRedriveToDlq alarm with threshold > 0", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsFailedToRedriveToDlq",
        Namespace: "AWS/SNS",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 0"),
      });
    });

    it("creates alarms with no actions", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        AlarmActions: Match.absent(),
      });
    });
  });

  describe("without a DLQ", () => {
    it("creates no alarms", () => {
      const { result, template } = buildResult(undefined, { attachDlq: false });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates no alarms even when recommendedAlarms is explicitly configured", () => {
      const { result, template } = buildResult(
        (b) => b.recommendedAlarms({ numberOfNotificationsRedrivenToDlq: { threshold: 5 } }),
        { attachDlq: false },
      );

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("customization", () => {
    it("allows customizing the redrive threshold", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ numberOfNotificationsRedrivenToDlq: { threshold: 10 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        Threshold: 10,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({
          numberOfNotificationsRedrivenToDlq: {
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
          },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({
          numberOfNotificationsRedrivenToDlq: { treatMissingData: TreatMissingData.BREACHING },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfNotificationsRedrivenToDlq",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms(false));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms({ enabled: false }));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({ numberOfNotificationsRedrivenToDlq: false }),
      );

      expect(result.alarms.numberOfNotificationsRedrivenToDlq).toBeUndefined();
      expect(result.alarms.numberOfNotificationsFailedToRedriveToDlq).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });
  });
});
