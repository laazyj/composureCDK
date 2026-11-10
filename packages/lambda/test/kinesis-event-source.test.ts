import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AttributeType, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  type IStream,
  type IStreamConsumer,
  Stream,
  StreamConsumer,
} from "aws-cdk-lib/aws-kinesis";
import {
  Code,
  Function as LambdaFunction,
  Runtime,
  StartingPosition,
} from "aws-cdk-lib/aws-lambda";
import {
  KinesisEventSource,
  type KinesisEventSourceProps,
  S3OnFailureDestination,
  SqsDlq,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { Bucket, type IBucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { policyJson } from "@composurecdk/cdk-testing";
import { isRef, ref } from "@composurecdk/core";
import { createFunctionBuilder } from "../src/function-builder.js";
import { dynamoEventSource } from "../src/event-sources/dynamodb-event-source.js";
import {
  DEFAULT_KINESIS_EVENT_SOURCE_PROPS,
  type KinesisStreamEventSourceProps,
  kinesisConsumerEventSource,
  kinesisEventSource,
} from "../src/event-sources/kinesis-event-source.js";
import { DEFAULT_STREAM_EVENT_SOURCE_PROPS } from "../src/event-sources/stream-event-source-defaults.js";

function baseBuilder(): ReturnType<typeof createFunctionBuilder> {
  return createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

function consumerOf(stack: Stack, stream: IStream = new Stream(stack, "Stream")): StreamConsumer {
  return new StreamConsumer(stack, "Consumer", { streamConsumerName: "efo", stream });
}

/**
 * Whether the installed aws-cdk-lib accepts an S3 on-failure destination on a
 * Kinesis mapping. `KinesisEventSource` only opts in via
 * `supportS3OnFailureDestination` from 2.184.0 — above this package's floor,
 * so `cdk-floors enforce` runs this suite on versions that refuse it. Probed by
 * synthesis rather than by version string, per ADR-0008's graceful-degradation
 * pattern.
 */
function kinesisAcceptsS3OnFailure(): boolean {
  const probe = new Stack(new App(), "S3OnFailureProbe");
  const fn = new LambdaFunction(probe, "Probe", {
    runtime: Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => {}"),
  });

  try {
    fn.addEventSource(
      new KinesisEventSource(new Stream(probe, "ProbeStream"), {
        startingPosition: StartingPosition.LATEST,
        onFailure: new S3OnFailureDestination(new Bucket(probe, "ProbeBucket")),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

describe("kinesisEventSource", () => {
  it("returns a ComposureEventSource of kind 'kinesis'", () => {
    const stack = new Stack(new App(), "S");

    expect(kinesisEventSource(new Stream(stack, "Stream")).kind).toBe("kinesis");
  });

  it("holds a concrete source for a concrete stream", () => {
    const stack = new Stack(new App(), "S");

    expect(isRef(kinesisEventSource(new Stream(stack, "Stream")).source)).toBe(false);
  });

  it("holds a Ref source for a Ref stream", () => {
    const source = kinesisEventSource(ref("telemetry", (r: { stream: IStream }) => r.stream));

    expect(isRef(source.source)).toBe(true);
  });

  it("exposes the shared stream defaults for visibility", () => {
    expect(DEFAULT_KINESIS_EVENT_SOURCE_PROPS).toBe(DEFAULT_STREAM_EVENT_SOURCE_PROPS);
    expect(DEFAULT_KINESIS_EVENT_SOURCE_PROPS.startingPosition).toBe("LATEST");
    expect(DEFAULT_KINESIS_EVENT_SOURCE_PROPS.reportBatchItemFailures).toBe(true);
    expect(DEFAULT_KINESIS_EVENT_SOURCE_PROPS.bisectBatchOnError).toBe(true);
    expect(DEFAULT_KINESIS_EVENT_SOURCE_PROPS.metricsConfig).toEqual({ metrics: ["EventCount"] });
  });
});

describe("KinesisStreamEventSourceProps", () => {
  it("accept everything CDK's own KinesisEventSourceProps accepts (type-level guard)", () => {
    // A re-declared prop must accept everything CDK's own prop accepts, so a
    // later re-declaration cannot silently narrow the builder's surface
    // (ADR-0018). A `tsc`-only assertion — vitest does not typecheck.
    const _props: KinesisStreamEventSourceProps = undefined as unknown as KinesisEventSourceProps;
  });
});

describe("FunctionBuilder.addEventSource (Kinesis)", () => {
  it("synthesises an event source mapping on the stream and grants stream read", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("telemetry", kinesisEventSource(new Stream(stack, "Stream")))
      .build(stack, "Fn");

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("Stream"), "Arn"] },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["kinesis:GetRecords", "kinesis:GetShardIterator"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
  });

  it("applies the secure stream defaults to the mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("telemetry", kinesisEventSource(new Stream(stack, "Stream")))
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "LATEST",
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BisectBatchOnFunctionError: true,
      MetricsConfig: { Metrics: ["EventCount"] },
    });
  });

  it("lets props override the secure defaults", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), {
          startingPosition: StartingPosition.AT_TIMESTAMP,
          startingPositionTimestamp: 1_700_000_000,
          bisectBatchOnError: false,
          batchSize: 500,
        }),
      )
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      StartingPosition: "AT_TIMESTAMP",
      StartingPositionTimestamp: 1_700_000_000,
      BisectBatchOnFunctionError: false,
      BatchSize: 500,
    });
  });

  it("resolves a Ref stream against the build context", () => {
    const stack = new Stack(new App(), "S");
    const stream = new Stream(stack, "Stream");

    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(ref("telemetry", (r: { stream: IStream }) => r.stream)),
      )
      .build(stack, "Fn", { telemetry: { stream } });

    Template.fromStack(stack).resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });
});

describe("kinesisConsumerEventSource (enhanced fan-out)", () => {
  it("returns a ComposureEventSource of kind 'kinesis'", () => {
    const stack = new Stack(new App(), "S");

    expect(kinesisConsumerEventSource(consumerOf(stack)).kind).toBe("kinesis");
  });

  it("holds a Ref source for a Ref consumer", () => {
    const source = kinesisConsumerEventSource(
      ref("efo", (r: { consumer: IStreamConsumer }) => r.consumer),
    );

    expect(isRef(source.source)).toBe(true);
  });

  it("maps the consumer ARN with the secure defaults and grants subscribe", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource("telemetry", kinesisConsumerEventSource(consumerOf(stack)))
      .build(stack, "Fn");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("Consumer"), "ConsumerARN"] },
      StartingPosition: "LATEST",
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BisectBatchOnFunctionError: true,
      MetricsConfig: { Metrics: ["EventCount"] },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(["kinesis:SubscribeToShard"]) }),
        ]),
      }),
    });
  });

  it("resolves a Ref consumer and Ref DLQ together via combine", () => {
    const stack = new Stack(new App(), "S");
    const consumer = consumerOf(stack);
    const queue = new Queue(stack, "Dlq");

    const source = kinesisConsumerEventSource(
      ref("efo", (r: { consumer: IStreamConsumer }) => r.consumer),
      { retryAttempts: 3, onFailure: ref("dlq", (r: { queue: Queue }) => r.queue) },
    );
    expect(isRef(source.source)).toBe(true);

    baseBuilder()
      .addEventSource("telemetry", source)
      .build(stack, "Fn", { efo: { consumer }, dlq: { queue } });

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      MaximumRetryAttempts: 3,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });
});

describe("kinesisEventSource onFailure DLQ", () => {
  it("wraps a bare queue as an SqsDlq destination on the mapping", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), {
          retryAttempts: 3,
          onFailure: new Queue(stack, "Dlq"),
        }),
      )
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      MaximumRetryAttempts: 3,
      DestinationConfig: {
        OnFailure: { Destination: { "Fn::GetAtt": [Match.stringLikeRegexp("Dlq"), "Arn"] } },
      },
    });
  });

  it("passes an explicit IEventSourceDlq through unwrapped", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), {
          maxRecordAge: Duration.hours(1),
          onFailure: new SqsDlq(new Queue(stack, "Dlq")),
        }),
      )
      .build(stack, "Fn");

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      MaximumRecordAgeInSeconds: 3600,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it("wraps a bare bucket in a least-privilege S3 destination", () => {
    const stack = new Stack(new App(), "S");
    const bucket = new Bucket(stack, "FailureBucket");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), {
          retryAttempts: 3,
          onFailure: ref("failures", (r: { bucket: IBucket }) => r.bucket),
        }),
      )
      .build(stack, "Fn", { failures: { bucket } });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      DestinationConfig: {
        OnFailure: {
          Destination: { "Fn::GetAtt": [Match.stringLikeRegexp("FailureBucket"), "Arn"] },
        },
      },
    });
    for (const action of ["s3:GetObject", "s3:DeleteObject", "s3:Abort"]) {
      expect(policyJson(stack)).not.toContain(action);
    }
  });

  it("resolves a Ref to a non-queue destination (an S3 bucket) without wrapping it", () => {
    const stack = new Stack(new App(), "S");
    const bucket = new Bucket(stack, "FailureBucket");

    const build = (): void => {
      baseBuilder()
        .addEventSource(
          "telemetry",
          kinesisEventSource(new Stream(stack, "Stream"), {
            retryAttempts: 3,
            onFailure: ref(
              "failureBucket",
              (r: { bucket: IBucket }) => new S3OnFailureDestination(r.bucket),
            ),
          }),
        )
        .build(stack, "Fn", { failureBucket: { bucket } });
    };

    if (!kinesisAcceptsS3OnFailure()) {
      // CDK's guard is an `instanceof`, so *this* error still proves the ref
      // resolved and reached it unwrapped.
      expect(build).toThrow(/S3 onFailure Destination is not supported/);
      return;
    }

    build();
    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      DestinationConfig: {
        OnFailure: {
          Destination: { "Fn::GetAtt": [Match.stringLikeRegexp("FailureBucket"), "Arn"] },
        },
      },
    });
  });

  it("makes the source lazy (a Ref) so a Ref stream and Ref DLQ resolve together", () => {
    const stack = new Stack(new App(), "S");
    const stream = new Stream(stack, "Stream");
    const queue = new Queue(stack, "Dlq");

    const source = kinesisEventSource(
      ref("telemetry", (r: { stream: IStream }) => r.stream),
      { retryAttempts: 3, onFailure: ref("dlq", (r: { queue: Queue }) => r.queue) },
    );
    expect(isRef(source.source)).toBe(true);

    baseBuilder()
      .addEventSource("telemetry", source)
      .build(stack, "Fn", { telemetry: { stream }, dlq: { queue } });

    Template.fromStack(stack).hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      MaximumRetryAttempts: 3,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });
});

describe("Kinesis contextual alarms", () => {
  it("creates per-mapping ESM alarms and the iteratorAge alarm for a Kinesis source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("telemetry", kinesisEventSource(new Stream(stack, "Stream")))
      .build(stack, "Fn");

    expect(result.alarms).toHaveProperty("telemetryFailedInvocations");
    expect(result.alarms).toHaveProperty("telemetryDroppedEvents");
    expect(result.alarms).toHaveProperty("iteratorAge");
  });

  it("creates the iteratorAge alarm for an enhanced fan-out source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource("telemetry", kinesisConsumerEventSource(consumerOf(stack)))
      .build(stack, "Fn");

    expect(result.alarms).toHaveProperty("telemetryFailedInvocations");
    expect(result.alarms).toHaveProperty("iteratorAge");
  });

  it("creates one iteratorAge alarm across mixed Kinesis and DynamoDB sources", () => {
    const stack = new Stack(new App(), "S");
    const table = new Table(stack, "T", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });
    baseBuilder()
      .addEventSource("telemetry", kinesisEventSource(new Stream(stack, "Stream")))
      .addEventSource("orders", dynamoEventSource(table))
      .build(stack, "Fn");

    Template.fromStack(stack).resourcePropertiesCountIs(
      "AWS::CloudWatch::Alarm",
      { MetricName: "IteratorAge" },
      1,
    );
  });

  it("does not create an iteratorAge alarm for a bare escape-hatch Kinesis source", () => {
    const stack = new Stack(new App(), "S");
    const result = baseBuilder()
      .addEventSource(
        "telemetry",
        new KinesisEventSource(new Stream(stack, "Stream"), {
          startingPosition: StartingPosition.LATEST,
        }),
      )
      .build(stack, "Fn");

    expect(result.alarms).not.toHaveProperty("iteratorAge");
  });
});

describe("stream dead-letter relationship guard (Kinesis)", () => {
  const ACK = "stream-dlq-missing";

  it("warns when retries are bounded but no onFailure destination is set", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), { retryAttempts: 3 }),
      )
      .build(stack, "Fn");

    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp(`no onFailure destination.*\\[ack: @composurecdk/lambda:${ACK}\\]`),
    );
  });

  it("warns for an enhanced fan-out source with a bounded record age and no destination", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisConsumerEventSource(consumerOf(stack), { maxRecordAge: Duration.hours(1) }),
      )
      .build(stack, "Fn");

    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp(ACK));
  });

  it("stays silent when a bounded retry has an onFailure DLQ", () => {
    const stack = new Stack(new App(), "S");
    baseBuilder()
      .addEventSource(
        "telemetry",
        kinesisEventSource(new Stream(stack, "Stream"), {
          retryAttempts: 3,
          onFailure: new Queue(stack, "Dlq"),
        }),
      )
      .build(stack, "Fn");

    expect(Annotations.fromStack(stack).findWarning("*", Match.stringLikeRegexp(ACK))).toEqual([]);
  });
});
