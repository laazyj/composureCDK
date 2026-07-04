import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { createQueueBuilder } from "../src/queue-builder.js";
import { DLQ_AGE_ALARM_RETENTION_RATIO } from "../src/dlq-alarm-defaults.js";
import { buildQueueStack, expectSharedSecureDefaults, setUntypedProp } from "./_helpers.js";

const createFifoDlqBuilder = () => createQueueBuilder("fifo-dlq");

function buildResult(configureFn?: (builder: ReturnType<typeof createFifoDlqBuilder>) => void) {
  return buildQueueStack(createFifoDlqBuilder, "OrderEventsDlq", configureFn);
}

describe('createQueueBuilder("fifo-dlq")', () => {
  it("combines the FIFO surface with the DLQ defaults", () => {
    const { template } = buildResult((b) => b.queueName("order-events-dlq.fifo"));

    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      QueueName: "order-events-dlq.fifo",
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
    expectSharedSecureDefaults(template);
  });

  it("creates the DLQ alarm set, scaled to the retention period", () => {
    const { result, template } = buildResult();

    expect(result.alarms.approximateNumberOfMessagesVisible).toBeDefined();
    expect(result.alarms.approximateNumberOfMessagesNotVisible).toBeUndefined();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesVisible",
      Threshold: 0,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateAgeOfOldestMessage",
      Threshold: Duration.days(14).toSeconds() * DLQ_AGE_ALARM_RETENTION_RATIO,
    });
  });

  it("validates the .fifo queueName suffix", () => {
    expect(() =>
      buildResult((b) => {
        setUntypedProp(b, "queueName", "order-events-dlq");
      }),
    ).toThrow(/QueueBuilder "OrderEventsDlq": FIFO queues require a queueName ending in ".fifo"/);
  });

  it("throws when a redrive policy is smuggled past the typed surface", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const sink = new Queue(stack, "Sink", { fifo: true });

    expect(() => {
      const builder = createQueueBuilder("fifo-dlq");
      setUntypedProp(builder, "deadLetterQueue", { queue: sink, maxReceiveCount: 5 });
      builder.build(stack, "OrderEventsDlq");
    }).toThrow(
      /deadLetterQueue is not supported on role "fifo-dlq".*createQueueBuilder\("fifo"\)/s,
    );
  });

  it("serves as a valid redrive target for a fifo-role primary", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const dlq = createQueueBuilder("fifo-dlq").build(stack, "OrderEventsDlq");

    expect(() =>
      createQueueBuilder("fifo")
        .deadLetterQueue({ queue: dlq.queue, maxReceiveCount: 5 })
        .build(stack, "OrderEvents"),
    ).not.toThrow();
  });
});
