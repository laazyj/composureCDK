import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType, type ITable, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Code, type IEventSource, Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { isRef, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createFunctionBuilder } from "../src/function-builder.js";
import {
  DEFAULT_SQS_EVENT_SOURCE_PROPS,
  sqsEventSource,
} from "../src/event-sources/sqs-event-source.js";
import {
  DEFAULT_DYNAMO_EVENT_SOURCE_PROPS,
  dynamoEventSource,
} from "../src/event-sources/dynamodb-event-source.js";

/** A table with a stream enabled, as `DynamoEventSource.bind` requires. */
function streamTable(stack: Stack, id = "T"): Table {
  return new Table(stack, id, {
    partitionKey: { name: "pk", type: AttributeType.STRING },
    stream: StreamViewType.NEW_AND_OLD_IMAGES,
  });
}

function baseBuilder(): ReturnType<typeof createFunctionBuilder> {
  return createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

describe("sqsEventSource", () => {
  it("returns a ComposureEventSource of kind 'sqs'", () => {
    const stack = new Stack(new App(), "S");
    const source = sqsEventSource(new Queue(stack, "Q"));

    expect(source.kind).toBe("sqs");
  });

  it("holds a concrete source for a concrete queue", () => {
    const stack = new Stack(new App(), "S");
    const source = sqsEventSource(new Queue(stack, "Q"));

    expect(isRef(source.source)).toBe(false);
  });

  it("holds a Ref source for a Ref queue", () => {
    const source = sqsEventSource(ref("orders", (r: { queue: Queue }) => r.queue));

    expect(isRef(source.source)).toBe(true);
  });

  it("exposes its secure defaults for visibility", () => {
    expect(DEFAULT_SQS_EVENT_SOURCE_PROPS.reportBatchItemFailures).toBe(true);
    expect(DEFAULT_SQS_EVENT_SOURCE_PROPS.metricsConfig).toEqual({ metrics: ["EventCount"] });
  });
});

describe("dynamoEventSource", () => {
  it("returns a ComposureEventSource of kind 'dynamodb'", () => {
    const stack = new Stack(new App(), "S");
    const source = dynamoEventSource(streamTable(stack));

    expect(source.kind).toBe("dynamodb");
  });

  it("holds a concrete source for a concrete table", () => {
    const stack = new Stack(new App(), "S");
    const source = dynamoEventSource(streamTable(stack));

    expect(isRef(source.source)).toBe(false);
  });

  it("holds a Ref source for a Ref table", () => {
    const source = dynamoEventSource(ref("orders", (r: { table: ITable }) => r.table));

    expect(isRef(source.source)).toBe(true);
  });

  it("exposes its secure defaults for visibility", () => {
    expect(DEFAULT_DYNAMO_EVENT_SOURCE_PROPS.startingPosition).toBe("LATEST");
    expect(DEFAULT_DYNAMO_EVENT_SOURCE_PROPS.reportBatchItemFailures).toBe(true);
    expect(DEFAULT_DYNAMO_EVENT_SOURCE_PROPS.metricsConfig).toEqual({ metrics: ["EventCount"] });
  });
});

describe("FunctionBuilder.addEventSource (DynamoDB)", () => {
  it("synthesises an event source mapping and grants stream read", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:GetRecords", "dynamodb:GetShardIterator"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("applies the secure DynamoDB defaults to the mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "LATEST",
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      MetricsConfig: { Metrics: ["EventCount"] },
    });
  });

  it("lets props override the secure defaults", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "orders",
        dynamoEventSource(streamTable(stack), { startingPosition: StartingPosition.TRIM_HORIZON }),
      )
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "TRIM_HORIZON",
    });
  });

  it("resolves a Ref table against the build context", () => {
    const stack = new Stack(new App(), "S");
    const table = streamTable(stack);

    baseBuilder()
      .addEventSource("orders", dynamoEventSource(ref("orders", (r: { table: ITable }) => r.table)))
      .build(stack, "Fn", { orders: { table } });

    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });
});

describe("FunctionBuilder.addEventSource", () => {
  it("throws on a duplicate key", () => {
    const stack = new Stack(new App(), "S");
    const builder = baseBuilder().addEventSource("orders", sqsEventSource(new Queue(stack, "Q")));

    expect(() => builder.addEventSource("orders", sqsEventSource(new Queue(stack, "Q2")))).toThrow(
      /duplicate key "orders"/,
    );
  });

  it("returns an empty eventSources record when none are added", () => {
    const result = baseBuilder().build(new Stack(new App(), "S"), "Fn");

    expect(result.eventSources).toEqual({});
  });

  it("exposes the resolved event source on the build result, keyed by key", () => {
    const stack = new Stack(new App(), "S");
    const source = sqsEventSource(new Queue(stack, "Q"));
    const result = baseBuilder().addEventSource("orders", source).build(stack, "Fn");

    expect(result.eventSources.orders).toBeInstanceOf(SqsEventSource);
  });

  it("synthesises an event source mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  it("applies the secure SQS defaults to the mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      MetricsConfig: { Metrics: ["EventCount"] },
    });
  });

  it("lets props override the secure defaults", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q"), { reportBatchItemFailures: false }),
      )
      .build(stack, "Fn");

    const mappings = Template.fromStack(stack).findResources("AWS::Lambda::EventSourceMapping");
    const [mapping] = Object.values(mappings) as { Properties: Record<string, unknown> }[];
    expect(mapping.Properties.FunctionResponseTypes).toBeUndefined();
  });

  it("grants the builder's least-privilege role permission to consume the queue", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["sqs:ReceiveMessage"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("resolves a Ref event source against the build context", () => {
    const stack = new Stack(new App(), "S");
    const queue = new Queue(stack, "Q");

    const result = baseBuilder()
      .addEventSource("orders", sqsEventSource(ref("orders", (r: { queue: Queue }) => r.queue)))
      .build(stack, "Fn", { orders: { queue } });

    expect(result.eventSources.orders).toBeInstanceOf(SqsEventSource);
    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  it("accepts a bare IEventSource as an escape hatch", () => {
    const stack = new Stack(new App(), "S");
    const bare: IEventSource = new SqsEventSource(new Queue(stack, "Q"));

    const result = baseBuilder().addEventSource("orders", bare).build(stack, "Fn");

    expect(result.eventSources.orders).toBe(bare);
    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  it("preserves #eventSources across .copy()", () => {
    assertCopyPreservesState({
      factory: baseBuilder,
      configure: (b) =>
        b.addEventSource("first", sqsEventSource(ref("q1", (r: { queue: Queue }) => r.queue))),
      mutate: (b) =>
        b.addEventSource("second", sqsEventSource(ref("q2", (r: { queue: Queue }) => r.queue))),
      build: (b) => {
        const stack = new Stack(new App(), "S");
        return b.build(stack, "Fn", {
          q1: { queue: new Queue(stack, "Q1") },
          q2: { queue: new Queue(stack, "Q2") },
        });
      },
      inspect: (r) => Object.keys(r.eventSources).sort(),
    });
  });
});

describe("event-source contextual alarms", () => {
  it("creates failed-invocation and dropped-event alarms when an SQS source is attached", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    expect(result.alarms).toHaveProperty("ordersFailedInvocations");
    expect(result.alarms).toHaveProperty("ordersDroppedEvents");
  });

  it("dimensions the alarm metric on the event source mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Lambda",
      MetricName: "FailedInvokeEventCount",
      Dimensions: [{ Name: "EventSourceMappingUUID", Value: Match.anyValue() }],
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("does not create event-source alarms when no event source is attached", () => {
    const result = baseBuilder().build(new Stack(new App(), "S"), "Fn");

    expect(result.alarms).not.toHaveProperty("ordersFailedInvocations");
    expect(result.alarms).not.toHaveProperty("ordersDroppedEvents");
  });

  it("does not create event-source alarms for a bare escape-hatch source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", new SqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("ordersFailedInvocations");
    expect(result.alarms).not.toHaveProperty("ordersDroppedEvents");
  });

  it("creates one set of alarms per attached SQS source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Orders")))
      .addEventSource("refunds", sqsEventSource(new Queue(stack, "Refunds")))
      .build(stack, "Fn");

    expect(Object.keys(result.alarms).sort()).toEqual(
      expect.arrayContaining([
        "ordersFailedInvocations",
        "ordersDroppedEvents",
        "refundsFailedInvocations",
        "refundsDroppedEvents",
      ]),
    );
  });

  it("tunes the alarm threshold via recommendedAlarms", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .recommendedAlarms({ eventSourceFailedInvocations: { threshold: 10 } })
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FailedInvokeEventCount",
      Threshold: 10,
    });
  });

  it("disables a single event-source alarm via recommendedAlarms", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .recommendedAlarms({ eventSourceFailedInvocations: false })
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("ordersFailedInvocations");
    expect(result.alarms).toHaveProperty("ordersDroppedEvents");
  });

  it("creates per-mapping alarms for a DynamoDB stream source too", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    expect(result.alarms).toHaveProperty("ordersFailedInvocations");
    expect(result.alarms).toHaveProperty("ordersDroppedEvents");
  });
});

describe("stream IteratorAge contextual alarm", () => {
  it("creates a single iteratorAge alarm when a DynamoDB stream source is attached", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    expect(result.alarms).toHaveProperty("iteratorAge");
  });

  it("dimensions the iteratorAge metric on the function with Maximum statistic", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Lambda",
      MetricName: "IteratorAge",
      Statistic: "Maximum",
      Dimensions: [{ Name: "FunctionName", Value: Match.anyValue() }],
      Threshold: 60_000,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("creates one iteratorAge alarm regardless of how many stream sources are attached", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack, "Orders")))
      .addEventSource("audit", dynamoEventSource(streamTable(stack, "Audit")))
      .build(stack, "Fn");

    const iteratorAgeKeys = Object.keys(result.alarms).filter((k) => k === "iteratorAge");
    expect(iteratorAgeKeys).toEqual(["iteratorAge"]);
  });

  it("does not create an iteratorAge alarm for an SQS-only function", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("iteratorAge");
  });

  it("does not create an iteratorAge alarm for a bare escape-hatch stream source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource(
        "orders",
        new DynamoEventSource(streamTable(stack), {
          startingPosition: StartingPosition.LATEST,
        }),
      )
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("iteratorAge");
  });

  it("disables the iteratorAge alarm via recommendedAlarms", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .recommendedAlarms({ eventSourceIteratorAge: false })
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("iteratorAge");
  });

  it("tunes the iteratorAge threshold via recommendedAlarms", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .recommendedAlarms({ eventSourceIteratorAge: { threshold: 120_000 } })
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "IteratorAge",
      Threshold: 120_000,
    });
  });
});

describe("SQS visibility-timeout relationship guard", () => {
  // The guard's stable ack id; every assertion scopes to it so an unrelated
  // warning (e.g. the token-timeout duration alarm) can't mask a false pass.
  const ACK = "sqs-visibility-timeout";

  const expectSilent = (stack: Stack): void => {
    expect(Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp(ACK))).toEqual([]);
  };
  const expectWarns = (stack: Stack, message: string): void => {
    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp(message));
  };

  it("warns when the queue visibilityTimeout is below 6x the function timeout", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(90) })),
      )
      .build(stack, "Fn");

    expectWarns(
      stack,
      `SQS event source "orders".*visibilityTimeout is 90s but should be >= 180s.*\\[ack: @composurecdk/lambda:${ACK}\\]`,
    );
  });

  it("stays silent when the queue visibilityTimeout meets the 6x target", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(180) })),
      )
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("computes the target from a minutes-based timeout", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.minutes(1))
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(90) })),
      )
      .build(stack, "Fn");

    expectWarns(stack, "visibilityTimeout is 90s but should be >= 360s");
  });

  it("stays silent for the default function timeout against the default queue", () => {
    // No timeout -> 3s (target 18s); a plain queue -> SQS default 30s. 30 >= 18.
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("orders", sqsEventSource(new Queue(stack, "Q")))
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("warns on the default 3s timeout when the queue is below the 18s target", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(10) })),
      )
      .build(stack, "Fn");

    expectWarns(stack, "visibilityTimeout is 10s but should be >= 18s");
  });

  it("warns once per attached SQS source, naming each by key", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Orders", { visibilityTimeout: Duration.seconds(90) })),
      )
      .addEventSource(
        "refunds",
        sqsEventSource(new Queue(stack, "Refunds", { visibilityTimeout: Duration.seconds(90) })),
      )
      .build(stack, "Fn");

    expectWarns(stack, `SQS event source "orders"`);
    expectWarns(stack, `SQS event source "refunds"`);
  });

  it("stays silent for an imported queue (no L1 to read)", () => {
    const stack = new Stack(new App(), "S");
    const imported = Queue.fromQueueArn(
      stack,
      "Imported",
      "arn:aws:sqs:us-east-1:123456789012:orders",
    );
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource("orders", sqsEventSource(imported))
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("stays silent for a bare escape-hatch source even when the queue violates", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource(
        "orders",
        new SqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(10) })),
      )
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("stays silent for a token-valued function timeout", () => {
    const stack = new Stack(new App(), "S");
    const param = new CfnParameter(stack, "TimeoutSeconds", { type: "Number", default: 30 });
    baseBuilder()
      .timeout(Duration.seconds(param.valueAsNumber))
      .addEventSource(
        "orders",
        sqsEventSource(new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(10) })),
      )
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("stays silent for a token-valued queue visibilityTimeout", () => {
    const stack = new Stack(new App(), "S");
    const param = new CfnParameter(stack, "VisibilitySeconds", { type: "Number", default: 10 });
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource(
        "orders",
        sqsEventSource(
          new Queue(stack, "Q", { visibilityTimeout: Duration.seconds(param.valueAsNumber) }),
        ),
      )
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("stays silent for a DynamoDB stream source", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .timeout(Duration.seconds(30))
      .addEventSource("orders", dynamoEventSource(streamTable(stack)))
      .build(stack, "Fn");

    expectSilent(stack);
  });

  it("stays silent when no event source is attached", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder().timeout(Duration.seconds(30)).build(stack, "Fn");

    expectSilent(stack);
  });
});
