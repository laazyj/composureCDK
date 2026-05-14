import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Code, type IEventSource, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { isRef, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createFunctionBuilder } from "../src/function-builder.js";
import {
  DEFAULT_SQS_EVENT_SOURCE_PROPS,
  sqsEventSource,
} from "../src/event-sources/sqs-event-source.js";

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
});
