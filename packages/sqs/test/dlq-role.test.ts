import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { createQueueBuilder } from "../src/queue-builder.js";
import { DLQ_QUEUE_DEFAULTS } from "../src/dlq-defaults.js";
import { DLQ_AGE_ALARM_RETENTION_RATIO } from "../src/dlq-alarm-defaults.js";
import {
  buildQueueStack,
  expectCopyPreservesCustomAlarms,
  expectSharedSecureDefaults,
  setUntypedProp,
} from "./_helpers.js";

const createDlqBuilder = () => createQueueBuilder("dlq");

function buildResult(configureFn?: (builder: ReturnType<typeof createDlqBuilder>) => void) {
  return buildQueueStack(createDlqBuilder, "OrdersDlq", configureFn);
}

describe("DLQ defaults", () => {
  it("DLQ_QUEUE_DEFAULTS sets retentionPeriod to the SQS maximum of 14 days", () => {
    expect(DLQ_QUEUE_DEFAULTS.retentionPeriod.toDays()).toBe(14);
  });
});

describe('createQueueBuilder("dlq")', () => {
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

    it("creates a standard (non-FIFO) queue", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", { FifoQueue: Match.absent() });
    });
  });

  describe("validation", () => {
    it("throws when a redrive policy is smuggled past the typed surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const sink = new Queue(stack, "Sink");

      expect(() => {
        const builder = createQueueBuilder("dlq");
        setUntypedProp(builder, "deadLetterQueue", { queue: sink, maxReceiveCount: 5 });
        builder.build(stack, "OrdersDlq");
      }).toThrow(
        /deadLetterQueue is not supported on role "dlq".*createQueueBuilder\("standard"\)/s,
      );
    });

    it("throws when a FIFO-only prop is smuggled onto the dlq role", () => {
      expect(() =>
        buildResult((b) => {
          setUntypedProp(b, "fifo", true);
        }),
      ).toThrow(
        /"fifo" is FIFO-specific and not supported on role "dlq".*createQueueBuilder\("fifo-dlq"\)/s,
      );
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

      const result = createQueueBuilder("dlq")
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
      expectCopyPreservesCustomAlarms(createDlqBuilder);
    });

    it("preserves the role across .copy() — the copy keeps the DLQ alarm set", () => {
      const { result, template } = buildQueueStack(
        () => createQueueBuilder("dlq").copy(),
        "OrdersDlq",
      );

      expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
      template.hasResourceProperties("AWS::SQS::Queue", {
        MessageRetentionPeriod: 14 * 24 * 60 * 60,
      });
    });
  });
});
