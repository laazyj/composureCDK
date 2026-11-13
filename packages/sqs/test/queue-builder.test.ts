import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type IQueue, Queue, QueueEncryption, type QueueProps } from "aws-cdk-lib/aws-sqs";
import { Key } from "aws-cdk-lib/aws-kms";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createQueueBuilder, type QueueBuilderResult } from "../src/queue-builder.js";
import type { QueueBuilderProps } from "../src/queue-props.js";
import { setUntypedProp } from "./_helpers.js";

const buildAndSynth = buildFixture(createQueueBuilder, "TestQueue");

/** An `sqs:SendMessage` grant to an AWS service on `resources`. */
function sendStatement(resources: string[], service = "sns.amazonaws.com") {
  return new PolicyStatement({
    principals: [new ServicePrincipal(service)],
    actions: ["sqs:SendMessage"],
    resources,
  });
}

/** The statements in the queue policies of `queue`'s stack. */
function policyStatements(queue: IQueue): unknown[] {
  const policies = Template.fromStack(Stack.of(queue)).findResources("AWS::SQS::QueuePolicy");
  return Object.values(policies).flatMap(
    (p) =>
      (p as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties.PolicyDocument
        .Statement,
  );
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
      const { template } = buildAndSynth();

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

  describe("props", () => {
    it("accept everything CDK's own QueueProps accepts (type-level guard)", () => {
      // A re-declared prop must accept everything CDK's own prop accepts, so a
      // later re-declaration cannot silently narrow the builder's surface
      // (ADR-0018). A `tsc`-only assertion — vitest does not typecheck.
      const _props: QueueBuilderProps = undefined as unknown as QueueProps;
    });
  });

  describe("secure defaults", () => {
    it("enables enforceSSL by default — deny on aws:SecureTransport=false", () => {
      const { template } = buildAndSynth();

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
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::SQS::Queue", {
        SqsManagedSseEnabled: true,
      });
    });

    it("enables long polling with a 20 second receive wait time by default", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::SQS::Queue", {
        ReceiveMessageWaitTimeSeconds: 20,
      });
    });

    it("allows enforceSSL to be disabled via the fluent API", () => {
      const { template } = buildAndSynth((b) => b.enforceSSL(false));

      template.resourceCountIs("AWS::SQS::QueuePolicy", 0);
    });

    it("allows receiveMessageWaitTime to be overridden", () => {
      const { template } = buildAndSynth((b) => b.receiveMessageWaitTime(Duration.seconds(0)));

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

    it("infers SSE-KMS from a supplied master key", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      createQueueBuilder().encryptionMasterKey(key).build(stack, "TestQueue");

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        KmsMasterKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
        SqsManagedSseEnabled: Match.absent(),
      });
    });

    it("resolves a Resolvable master key from the build context", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      createQueueBuilder()
        .encryptionMasterKey(ref<{ key: Key }, Key>("queueKey", (r) => r.key))
        .build(stack, "TestQueue", { queueKey: { key } });

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        KmsMasterKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
      });
    });
  });

  describe("dead-letter queue", () => {
    it("wires a composed dead-letter queue through a ref", () => {
      const stack = newStack();
      const { orders, ordersDlq } = compose(
        {
          ordersDlq: createQueueBuilder("dlq"),
          orders: createQueueBuilder().deadLetterQueue(
            ref("ordersDlq", (r: QueueBuilderResult) => ({ queue: r.queue, maxReceiveCount: 5 })),
          ),
        },
        { ordersDlq: [], orders: ["ordersDlq"] },
      ).build(stack, "System");

      expect(orders.queue.deadLetterQueue?.queue).toBe(ordersDlq.queue);
      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        RedrivePolicy: {
          deadLetterTargetArn: stack.resolve(ordersDlq.queue.queueArn) as unknown,
          maxReceiveCount: 5,
        },
      });
    });
  });

  describe("synthesised output", () => {
    it("creates a queue with the specified queue name", () => {
      const { template } = buildAndSynth((b) => b.queueName("orders"));

      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "orders",
      });
    });

    it("throws when a FIFO-only prop is smuggled past the typed surface", () => {
      // The standard role omits the FIFO props at the type level; the
      // runtime guard catches untyped (JavaScript) callers and points
      // them at the FIFO roles.
      expect(() =>
        buildAndSynth((b) => {
          setUntypedProp(b, "fifo", true);
          b.queueName("orders.fifo");
        }),
      ).toThrow(
        /"fifo" is FIFO-specific and not supported on role "standard".*createQueueBuilder\("fifo"\)/s,
      );
    });

    it.each([
      ["a concrete", (queue: Queue) => ({ queue, maxReceiveCount: 5 })],
      // Resolved before validation, so the guard sees the real queue.
      [
        "a ref'd",
        () => ref("dlq", (r: { queue: Queue }) => ({ queue: r.queue, maxReceiveCount: 5 })),
      ],
    ])("throws when %s redrive target is a FIFO queue", (_, deadLetterQueue) => {
      const stack = newStack();
      const fifoDlq = new Queue(stack, "Dlq", { fifo: true });

      expect(() =>
        createQueueBuilder()
          .deadLetterQueue(deadLetterQueue(fifoDlq))
          .build(stack, "Orders", { dlq: { queue: fifoDlq } }),
      ).toThrow(/standard queue cannot redrive to the FIFO dead-letter queue "Dlq"/);
    });

    it("forwards the visibility timeout to the underlying CDK construct", () => {
      const { template } = buildAndSynth((b) => b.visibilityTimeout(Duration.seconds(120)));

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

    it("preserves #policyStatements across .copy()", () => {
      assertCopyPreservesState({
        factory: () => createQueueBuilder(),
        configure: (b) => {
          b.addToResourcePolicy(sendStatement(["*"], "first.amazonaws.com"));
        },
        mutate: (b) => {
          b.addToResourcePolicy(sendStatement(["*"], "second.amazonaws.com"));
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Queue"),
        inspect: (r) => policyStatements(r.queue).length,
      });
    });
  });

  describe("addToResourcePolicy", () => {
    const SEND_STATEMENT = {
      Effect: "Allow",
      Principal: { Service: "sns.amazonaws.com" },
      Action: "sqs:SendMessage",
    };

    it("adds a concrete statement to the queue's own policy, beside enforceSSL", () => {
      const { template } = buildAndSynth((b) => b.addToResourcePolicy(sendStatement(["*"])));

      template.resourceCountIs("AWS::SQS::QueuePolicy", 1);
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
            Match.objectLike({ ...SEND_STATEMENT, Resource: "*" }),
          ]),
        },
      });
    });

    it("creates the policy when enforceSSL is off", () => {
      const { template } = buildAndSynth((b) =>
        b.enforceSSL(false).addToResourcePolicy(sendStatement(["*"])),
      );

      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: {
          Statement: [Match.objectLike({ ...SEND_STATEMENT, Resource: "*" })],
        },
      });
    });

    it("passes the built queue to a function, so the statement can name its ARN", () => {
      const { template, result, stack } = buildAndSynth((b) =>
        b.addToResourcePolicy((queue) => sendStatement([queue.queueArn])),
      );

      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              ...SEND_STATEMENT,
              Resource: stack.resolve(result.queue.queueArn) as unknown,
            }),
          ]),
        },
      });
    });

    it("resolves a ref against the build context, including one a function returns", () => {
      const sourceArn = "arn:aws:sns:eu-west-1:111122223333:orders";
      const statementFor = (resources: string[]) =>
        ref<{ arn: string }, PolicyStatement>("topic", (r) => {
          const statement = sendStatement(resources);
          statement.addCondition("ArnEquals", { "aws:SourceArn": r.arn });
          return statement;
        });

      const { template, result, stack } = buildAndSynth(
        (b) =>
          b
            .addToResourcePolicy(statementFor(["*"]))
            .addToResourcePolicy((queue) => statementFor([queue.queueArn])),
        { context: { topic: { arn: sourceArn } } },
      );

      const condition = { ArnEquals: { "aws:SourceArn": sourceArn } };
      template.hasResourceProperties("AWS::SQS::QueuePolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ ...SEND_STATEMENT, Resource: "*", Condition: condition }),
            Match.objectLike({
              ...SEND_STATEMENT,
              Resource: stack.resolve(result.queue.queueArn) as unknown,
              Condition: condition,
            }),
          ]),
        },
      });
    });

    it("applies to a dead-letter role too", () => {
      const result = createQueueBuilder("dlq")
        .addToResourcePolicy((queue) => sendStatement([queue.queueArn]))
        .build(new Stack(new App(), "S"), "Dlq");

      expect(policyStatements(result.queue)).toHaveLength(2);
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
      const { result, template } = buildAndSynth((b) => {
        b.queueName("orders");
        b.addAlarm("highEmptyReceiveRate", (a) =>
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
        );
      });

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
