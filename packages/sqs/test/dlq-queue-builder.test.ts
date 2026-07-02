import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { createDlqQueueBuilder } from "../src/dlq-queue-builder.js";
import { DLQ_QUEUE_DEFAULTS } from "../src/dlq-defaults.js";
import { DLQ_AGE_ALARM_RETENTION_RATIO } from "../src/dlq-alarm-defaults.js";
import {
  buildQueueStack,
  expectCopyPreservesCustomAlarms,
  expectSharedSecureDefaults,
} from "./_helpers.js";

function buildResult(configureFn?: (builder: ReturnType<typeof createDlqQueueBuilder>) => void) {
  return buildQueueStack(createDlqQueueBuilder, "OrdersDlq", configureFn);
}

describe("DLQ defaults", () => {
  it("DLQ_QUEUE_DEFAULTS sets retentionPeriod to the SQS maximum of 14 days", () => {
    expect(DLQ_QUEUE_DEFAULTS.retentionPeriod.toDays()).toBe(14);
  });
});

describe("DlqQueueBuilder", () => {
  describe("queue defaults", () => {
    it("applies a 14-day retention period", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: 14 * 24 * 60 * 60,
      });
    });

    it("still applies the shared secure defaults", () => {
      const { template } = buildResult();

      expectSharedSecureDefaults(template);
    });

    it("allows retentionPeriod to be overridden via the fluent API", () => {
      const { template } = buildResult((b) => b.retentionPeriod(Duration.days(4)));

      template.hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: 4 * 24 * 60 * 60,
      });
    });
  });

  describe("validation", () => {
    it("throws when a redrive policy is smuggled past the typed surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const sink = new Queue(stack, "Sink");

      expect(() => {
        const builder = createDlqQueueBuilder();
        // deadLetterQueue is excluded from the typed surface; cast to mimic an untyped caller
        (builder as unknown as { deadLetterQueue(value: object): unknown }).deadLetterQueue({
          queue: sink,
          maxReceiveCount: 5,
        });
        builder.build(stack, "OrdersDlq");
      }).toThrow(/deadLetterQueue is not supported on a dead-letter queue/);
    });

    it("validates the .fifo suffix when building a FIFO DLQ", () => {
      expect(() => buildResult((b) => b.fifo(true).queueName("orders-dlq"))).toThrow(
        /DlqQueueBuilder "OrdersDlq": FIFO queues require a queueName ending in ".fifo"/,
      );
    });

    it("builds a FIFO DLQ for a FIFO source queue", () => {
      const { template } = buildResult((b) => b.fifo(true).queueName("orders-dlq.fifo"));

      template.hasResourceProperties("AWS::SQS::Queue", {
        FifoQueue: true,
        QueueName: "orders-dlq.fifo",
        MessageRetentionPeriod: 14 * 24 * 60 * 60,
      });
    });
  });

  describe("recommended alarms", () => {
    it("creates the inverted DLQ alarm set by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
      expect(result.alarms.approximateAgeOfOldestMessage).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("alarms on any visible message (> 0)", () => {
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

    it("alarms when the oldest message reaches 75% of the default retention", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: Duration.days(14).toSeconds() * DLQ_AGE_ALARM_RETENTION_RATIO,
      });
    });

    it("scales the age threshold to an overridden retention period", () => {
      const { template } = buildResult((b) => b.retentionPeriod(Duration.days(4)));

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: 4 * 24 * 60 * 60 * DLQ_AGE_ALARM_RETENTION_RATIO,
      });
    });

    it("an explicit age threshold wins over the retention-derived default", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ approximateAgeOfOldestMessage: { threshold: 3600 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: 3600,
      });
    });

    it("skips the age alarm with a warning when retention is an unresolved token", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const retentionParam = new CfnParameter(stack, "Retention", {
        type: "Number",
        default: 1209600,
      });

      const result = createDlqQueueBuilder()
        .retentionPeriod(Duration.seconds(retentionParam.valueAsNumber))
        .build(stack, "OrdersDlq");

      expect(result.alarms.approximateAgeOfOldestMessage).toBeUndefined();
      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
      Annotations.fromStack(stack).hasWarning(
        "/TestStack",
        Match.stringLikeRegexp(
          "Skipping the recommended dead-letter queue message-age alarm.*" +
            "\\[ack: @composurecdk/sqs:dlq-age-alarm-token-retention\\]",
        ),
      );
    });

    it("allows overriding the visible-messages threshold", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesVisible: { threshold: 5 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesVisible",
        Threshold: 5,
      });
    });

    it("allows disabling individual DLQ alarms", () => {
      const { result, template } = buildResult((b) =>
        b.recommendedAlarms({
          approximateNumberOfMessagesVisible: false,
          approximateAgeOfOldestMessage: false,
        }),
      );

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("allows opting back into the in-flight alarm, inheriting the shared baseline", () => {
      const { template, result } = buildResult((b) =>
        b.recommendedAlarms({ approximateNumberOfMessagesNotVisible: {} }),
      );

      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesNotVisible",
        Threshold: 90_000,
      });
    });

    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => b.recommendedAlarms(false));

      expect(Object.keys(result.alarms)).toHaveLength(0);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      expectCopyPreservesCustomAlarms(createDlqQueueBuilder);
    });
  });
});
