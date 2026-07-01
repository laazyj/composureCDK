import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createQueueBuilder } from "../src/queue-builder.js";
import { DLQ_QUEUE_DEFAULTS } from "../src/dlq-defaults.js";
import { DLQ_ALARM_DEFAULTS } from "../src/dlq-alarm-defaults.js";

function buildResult(configureFn?: (builder: ReturnType<typeof createQueueBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createQueueBuilder().asDeadLetterQueue();
  configureFn?.(builder);
  const result = builder.build(stack, "OrdersDlq");
  return { stack, result, template: Template.fromStack(stack) };
}

describe("DLQ_QUEUE_DEFAULTS", () => {
  it("sets retentionPeriod to the SQS maximum of 14 days", () => {
    expect(DLQ_QUEUE_DEFAULTS.retentionPeriod?.toDays()).toBe(14);
  });
});

describe("DLQ_ALARM_DEFAULTS", () => {
  it("inverts enablement relative to a primary queue", () => {
    expect(DLQ_ALARM_DEFAULTS).toEqual({
      approximateAgeOfOldestMessage: false,
      approximateNumberOfMessagesNotVisible: false,
      approximateNumberOfMessagesVisible: true,
    });
  });
});

describe("QueueBuilder.asDeadLetterQueue()", () => {
  describe("queue defaults", () => {
    it("applies a 14-day retention period", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: 14 * 24 * 60 * 60,
      });
    });

    it("still applies the shared secure defaults (enforceSSL, encryption, long polling)", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", {
        SqsManagedSseEnabled: true,
        ReceiveMessageWaitTimeSeconds: 20,
      });
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
          ]),
        }),
      });
    });

    it("allows retentionPeriod to be overridden via the fluent API", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");

      createQueueBuilder()
        .asDeadLetterQueue()
        .retentionPeriod(Duration.days(4))
        .build(stack, "OrdersDlq");

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: 4 * 24 * 60 * 60,
      });
    });

    it("warns when the DLQ also configures its own redrive policy", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const sink = new Queue(stack, "Sink");

      createQueueBuilder()
        .asDeadLetterQueue()
        .deadLetterQueue({ queue: sink, maxReceiveCount: 5 })
        .build(stack, "OrdersDlq");

      Annotations.fromStack(stack).hasWarning(
        "/TestStack",
        Match.stringLikeRegexp(
          "built via asDeadLetterQueue\\(\\) but also configures its own.*\\[ack: @composurecdk/sqs:dlq-with-redrive-policy\\]",
        ),
      );
    });

    it("does not warn about a redrive policy on a primary queue", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const sink = new Queue(stack, "Sink");

      createQueueBuilder()
        .deadLetterQueue({ queue: sink, maxReceiveCount: 5 })
        .build(stack, "Orders");

      expect(
        Annotations.fromStack(stack).findWarning(
          "*",
          Match.stringLikeRegexp("dlq-with-redrive-policy"),
        ),
      ).toEqual([]);
    });
  });

  describe("recommended alarms", () => {
    it("creates only the approximateNumberOfMessagesVisible alarm by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
      expect(result.alarms.approximateAgeOfOldestMessage).toBeUndefined();
      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates the approximateNumberOfMessagesVisible alarm with threshold > 0", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesVisible",
        Namespace: "AWS/SQS",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        Statistic: "Maximum",
        Period: 60,
      });
    });

    it("allows opting back into approximateAgeOfOldestMessage on a DLQ", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({ approximateAgeOfOldestMessage: { threshold: 600 } }),
      );

      expect(result.alarms.approximateAgeOfOldestMessage).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: 600,
      });
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("allows opting back into approximateNumberOfMessagesNotVisible on a DLQ", () => {
      const { result } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesNotVisible: { threshold: 1000 } }),
      );

      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeDefined();
    });

    it("allows disabling the default-on approximateNumberOfMessagesVisible alarm", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesVisible: false }),
      );

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("allows overriding the approximateNumberOfMessagesVisible threshold", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesVisible: { threshold: 5 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesVisible",
        Threshold: 5,
      });
    });

    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms(false));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("primary queue (unaffected)", () => {
    it("still creates the primary-queue alarm set by default and not approximateNumberOfMessagesVisible", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder().build(stack, "Orders");

      expect(result.alarms.approximateAgeOfOldestMessage).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesVisible).toBeUndefined();
    });

    it("allows opting into approximateNumberOfMessagesVisible on a primary queue", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder()
        .recommendedAlarms({ approximateNumberOfMessagesVisible: { threshold: 1000 } })
        .build(stack, "Orders");

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
    });

    it("leaves retentionPeriod at the CDK default (not 14 days)", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      createQueueBuilder().build(stack, "Orders");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: Match.absent(),
      });
    });
  });

  describe("copy", () => {
    it("preserves the dlq role across .copy()", () => {
      // If the role were not copied, the clone would fall back to the
      // primary-queue alarm defaults instead of the DLQ ones, and this
      // assertion would catch the mismatch.
      assertCopyPreservesState({
        factory: () => createQueueBuilder(),
        configure: (b) => {
          b.asDeadLetterQueue();
        },
        mutate: (b) => {
          b.addAlarm("customOne", (a) =>
            a
              .metric((queue) => queue.metricNumberOfEmptyReceives())
              .threshold(1)
              .greaterThan(),
          );
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Queue"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
