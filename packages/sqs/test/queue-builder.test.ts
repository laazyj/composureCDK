import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { type IQueue, Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Key } from "aws-cdk-lib/aws-kms";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createQueueBuilder } from "../src/queue-builder.js";

function synthTemplate(
  configureFn?: (builder: ReturnType<typeof createQueueBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createQueueBuilder();
  configureFn?.(builder);
  builder.build(stack, "TestQueue");
  return Template.fromStack(stack);
}

describe("QueueBuilder", () => {
  describe("build", () => {
    it("returns a QueueBuilderResult with a queue property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder().build(stack, "TestQueue");

      expect(result).toBeDefined();
      expect(result.queue).toBeDefined();
    });

    it("creates exactly one SQS queue", () => {
      const template = synthTemplate();

      template.resourceCountIs("AWS::SQS::Queue", 1);
    });

    it("exposes the alarms record in the result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder().build(stack, "TestQueue");

      expect(result.alarms).toBeDefined();
      expect(typeof result.alarms).toBe("object");
    });
  });

  describe("resolvedProps", () => {
    it("exposes the merged defaults handed to the queue construct", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder().build(stack, "TestQueue");

      expect(result.resolvedProps.enforceSSL).toBe(true);
      expect(result.resolvedProps.encryption).toBe(QueueEncryption.SQS_MANAGED);
      expect(result.resolvedProps.receiveMessageWaitTime?.toSeconds()).toBe(20);
    });

    it("exposes a write-only prop the Queue construct does not re-surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder()
        .visibilityTimeout(Duration.seconds(90))
        .build(stack, "TestQueue");

      expect(result.resolvedProps.visibilityTimeout?.toSeconds()).toBe(90);
    });

    it("lets a user value override a default in the snapshot", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const result = createQueueBuilder()
        .receiveMessageWaitTime(Duration.seconds(5))
        .build(stack, "TestQueue");

      expect(result.resolvedProps.receiveMessageWaitTime?.toSeconds()).toBe(5);
    });

    it("preserves nested values by reference so unresolved tokens pass through", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const visibilityTimeout = Duration.seconds(45);
      const result = createQueueBuilder()
        .visibilityTimeout(visibilityTimeout)
        .build(stack, "TestQueue");

      expect(result.resolvedProps.visibilityTimeout).toBe(visibilityTimeout);
    });
  });

  describe("secure defaults", () => {
    it("enables enforceSSL by default — deny on aws:SecureTransport=false", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Action: "sqs:*",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
          ]),
        }),
      });
    });

    it("encrypts at rest with SQS_MANAGED by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::SQS::Queue", {
        SqsManagedSseEnabled: true,
      });
    });

    it("enables long polling with a 20 second receive wait time by default", () => {
      const template = synthTemplate();

      template.hasResourceProperties("AWS::SQS::Queue", {
        ReceiveMessageWaitTimeSeconds: 20,
      });
    });

    it("allows enforceSSL to be disabled via the fluent API", () => {
      const template = synthTemplate((b) => b.enforceSSL(false));

      template.resourceCountIs("AWS::SQS::QueuePolicy", 0);
    });

    it("allows receiveMessageWaitTime to be overridden", () => {
      const template = synthTemplate((b) => b.receiveMessageWaitTime(Duration.seconds(0)));

      template.hasResourceProperties("AWS::SQS::Queue", {
        ReceiveMessageWaitTimeSeconds: 0,
      });
    });

    it("allows the encryption mode to be overridden to a customer-managed KMS key", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const key = new Key(stack, "Key");

      createQueueBuilder()
        .encryption(QueueEncryption.KMS)
        .encryptionMasterKey(key)
        .build(stack, "TestQueue");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::SQS::Queue", {
        KmsMasterKeyId: Match.anyValue(),
      });
    });
  });

  describe("synthesised output", () => {
    it("creates a queue with the specified queue name", () => {
      const template = synthTemplate((b) => b.queueName("orders"));

      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "orders",
      });
    });

    it("creates a FIFO queue when configured", () => {
      const template = synthTemplate((b) => b.fifo(true).queueName("orders.fifo"));

      template.hasResourceProperties("AWS::SQS::Queue", {
        FifoQueue: true,
        QueueName: "orders.fifo",
      });
    });

    it("forwards the visibility timeout to the underlying CDK construct", () => {
      const template = synthTemplate((b) => b.visibilityTimeout(Duration.seconds(120)));

      template.hasResourceProperties("AWS::SQS::Queue", {
        VisibilityTimeout: 120,
      });
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      const emptyReceives = (queue: IQueue): Metric =>
        new Metric({
          namespace: "AWS/SQS",
          metricName: "NumberOfEmptyReceives",
          dimensionsMap: { QueueName: queue.queueName },
          statistic: "Sum",
          period: Duration.minutes(1),
        });

      assertCopyPreservesState({
        factory: () => createQueueBuilder(),
        configure: (b) => {
          b.addAlarm("firstCustom", (a) => a.metric(emptyReceives).threshold(1).greaterThan());
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) => a.metric(emptyReceives).threshold(5).greaterThan());
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Queue"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });

  describe("redrive policy maxReceiveCount warning", () => {
    function buildWithDlq(maxReceiveCount: number, id = "Orders"): Stack {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const dlq = new Queue(stack, "Dlq");
      createQueueBuilder().deadLetterQueue({ queue: dlq, maxReceiveCount }).build(stack, id);
      return stack;
    }

    it.each([1, 2, 3, 4])(
      "warns when maxReceiveCount is %i (below the AWS-recommended minimum of 5)",
      (maxReceiveCount) => {
        const stack = buildWithDlq(maxReceiveCount);

        // The ack tag is what callers use to suppress the warning via
        // `Annotations.of(scope).acknowledgeWarning(...)`, so the ID is part of
        // the public surface — guard against accidental rename.
        Annotations.fromStack(stack).hasWarning(
          "/TestStack",
          Match.stringLikeRegexp(
            `QueueBuilder "Orders": redrive policy maxReceiveCount is ${String(maxReceiveCount)}.*` +
              "\\[ack: @composurecdk/sqs:redrive-low-max-receive-count\\]",
          ),
        );
      },
    );

    it.each([5, 10, 100])("does not warn when maxReceiveCount is %i (at or above 5)", (n) => {
      const stack = buildWithDlq(n);

      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
    });

    it("does not warn when no dead-letter queue is configured", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      createQueueBuilder().build(stack, "TestQueue");

      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
    });

    it("does not warn when maxReceiveCount is an unresolved token", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const dlq = new Queue(stack, "Dlq");
      const param = new CfnParameter(stack, "MaxReceives", { type: "Number", default: 3 });

      createQueueBuilder()
        .deadLetterQueue({ queue: dlq, maxReceiveCount: param.valueAsNumber })
        .build(stack, "TestQueue");

      expect(Annotations.fromStack(stack).findWarning("*", Match.anyValue())).toEqual([]);
    });
  });

  describe("addAlarm", () => {
    it("creates a custom alarm using the supplied metric and threshold", () => {
      const { result, template } = (() => {
        const app = new App();
        const stack = new Stack(app, "TestStack");
        const result = createQueueBuilder()
          .queueName("orders")
          .addAlarm("highEmptyReceiveRate", (a) =>
            a
              .metric(
                (queue) =>
                  new Metric({
                    namespace: "AWS/SQS",
                    metricName: "NumberOfEmptyReceives",
                    dimensionsMap: { QueueName: queue.queueName },
                    statistic: "Sum",
                    period: Duration.minutes(1),
                  }),
              )
              .threshold(1000)
              .greaterThan()
              .description("Queue receiving an unusually high number of empty receives."),
          )
          .build(stack, "TestQueue");
        return { result, template: Template.fromStack(stack) };
      })();

      expect(result.alarms.highEmptyReceiveRate).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "NumberOfEmptyReceives",
        Namespace: "AWS/SQS",
        Threshold: 1000,
        ComparisonOperator: "GreaterThanThreshold",
      });
    });
  });
});
