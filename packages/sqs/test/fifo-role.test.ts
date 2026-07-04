import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { DeduplicationScope, FifoThroughputLimit, Queue } from "aws-cdk-lib/aws-sqs";
import { createQueueBuilder } from "../src/queue-builder.js";
import {
  buildQueueStack,
  expectCopyPreservesCustomAlarms,
  expectSharedSecureDefaults,
  setUntypedProp,
} from "./_helpers.js";

const createFifoBuilder = () => createQueueBuilder("fifo");

function buildResult(configureFn?: (builder: ReturnType<typeof createFifoBuilder>) => void) {
  return buildQueueStack(createFifoBuilder, "OrderEvents", configureFn);
}

describe('createQueueBuilder("fifo")', () => {
  describe("build", () => {
    it("always creates a FIFO queue", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", { FifoQueue: true });
    });

    it("builds without a queueName — CloudFormation generates a valid one", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::SQS::Queue", { QueueName: Match.absent() });
    });

    it("creates a queue with the specified .fifo queue name", () => {
      const { template } = buildResult((b) => b.queueName("order-events.fifo"));

      template.hasResourceProperties("AWS::SQS::Queue", {
        FifoQueue: true,
        QueueName: "order-events.fifo",
      });
    });

    it("forwards FIFO-specific props to the underlying CDK construct", () => {
      const { template } = buildResult((b) =>
        b
          .contentBasedDeduplication(true)
          .deduplicationScope(DeduplicationScope.MESSAGE_GROUP)
          .fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID),
      );

      template.hasResourceProperties("AWS::SQS::Queue", {
        ContentBasedDeduplication: true,
        DeduplicationScope: "messageGroup",
        FifoThroughputLimit: "perMessageGroupId",
      });
    });

    it("forwards shared QueueProps to the underlying CDK construct", () => {
      const { template } = buildResult((b) => b.visibilityTimeout(Duration.seconds(120)));

      template.hasResourceProperties("AWS::SQS::Queue", { VisibilityTimeout: 120 });
    });

    it("applies the shared secure defaults", () => {
      const { template } = buildResult();

      expectSharedSecureDefaults(template);
    });
  });

  describe("validation", () => {
    it("throws when queueName does not end in .fifo", () => {
      expect(() =>
        buildResult((b) => {
          setUntypedProp(b, "queueName", "order-events");
        }),
      ).toThrow(/QueueBuilder "OrderEvents": FIFO queues require a queueName ending in ".fifo"/);
    });

    it("throws when high-throughput mode is missing the message-group dedup scope", () => {
      expect(() =>
        buildResult((b) => b.fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID)),
      ).toThrow(/requires deduplicationScope=MESSAGE_GROUP/);
    });

    it("accepts high-throughput mode with deduplicationScope MESSAGE_GROUP", () => {
      expect(() =>
        buildResult((b) =>
          b
            .fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID)
            .deduplicationScope(DeduplicationScope.MESSAGE_GROUP),
        ),
      ).not.toThrow();
    });

    it("throws when the redrive target is a standard queue", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const standardDlq = new Queue(stack, "Dlq");

      expect(() =>
        createQueueBuilder("fifo")
          .deadLetterQueue({ queue: standardDlq, maxReceiveCount: 5 })
          .build(stack, "OrderEvents"),
      ).toThrow(/FIFO queue cannot redrive to the standard dead-letter queue "Dlq"/);
    });

    it("accepts a FIFO redrive target and keeps the maxReceiveCount warning", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const fifoDlq = new Queue(stack, "Dlq", { fifo: true });

      createQueueBuilder("fifo")
        .deadLetterQueue({ queue: fifoDlq, maxReceiveCount: 2 })
        .build(stack, "OrderEvents");

      Annotations.fromStack(stack).hasWarning(
        "/TestStack",
        Match.stringLikeRegexp(
          'QueueBuilder "OrderEvents": redrive policy maxReceiveCount is 2.*' +
            "\\[ack: @composurecdk/sqs:redrive-low-max-receive-count\\]",
        ),
      );
    });
  });

  describe("recommended alarms", () => {
    it("creates the primary-queue alarm set with the shared thresholds", () => {
      const { result, template } = buildResult();

      expect(result.alarms.approximateAgeOfOldestMessage).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeDefined();
      expect(result.alarms.approximateNumberOfMessagesVisible).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateNumberOfMessagesNotVisible",
        Threshold: 90_000,
      });
    });

    it("allows tuning an individual alarm", () => {
      const { template } = buildResult((b) =>
        b.recommendedAlarms({ approximateAgeOfOldestMessage: { threshold: 60 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ApproximateAgeOfOldestMessage",
        Threshold: 60,
      });
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      expectCopyPreservesCustomAlarms(createFifoBuilder);
    });

    it("preserves the role across .copy() — the role is props, not hidden state", () => {
      const { template } = buildQueueStack(() => createQueueBuilder("fifo").copy(), "OrderEvents");

      template.hasResourceProperties("AWS::SQS::Queue", { FifoQueue: true });
    });
  });
});
