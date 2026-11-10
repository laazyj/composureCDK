import { describe, it, expect } from "vitest";
import { App, Stack, TagManager } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import {
  type IStreamConsumer,
  Stream,
  StreamConsumer,
  type StreamConsumerProps,
} from "aws-cdk-lib/aws-kinesis";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  createStreamConsumerBuilder,
  type StreamConsumerBuilderProps,
} from "../src/stream-consumer-builder.js";

const buildAndSynth = buildFixture(createStreamConsumerBuilder, "TestConsumer", {
  seed: (b, stack) => {
    b.streamConsumerName("alerter").stream(
      new Stream(stack, "Stream", { streamName: "telemetry" }),
    );
  },
});

const subscribeToShardRate = (consumer: IStreamConsumer) =>
  new Metric({
    namespace: "AWS/Kinesis",
    metricName: "SubscribeToShardEvent.Records",
    dimensionsMap: {
      StreamName: consumer.stream.streamName,
      ConsumerName: consumer.streamConsumerName,
    },
  });

describe("StreamConsumerBuilder", () => {
  describe("build", () => {
    it("registers exactly one consumer with the stream", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::Kinesis::StreamConsumer", 1);
      template.hasResourceProperties("AWS::Kinesis::StreamConsumer", {
        ConsumerName: "alerter",
        StreamARN: { "Fn::GetAtt": [Match.stringLikeRegexp("^Stream"), "Arn"] },
      });
    });

    it("returns the consumer and the recommended alarm", () => {
      const { result } = buildAndSynth();

      expect(result.consumer).toBeInstanceOf(StreamConsumer);
      expect(Object.keys(result.alarms)).toEqual(["subscribeToShardEventMillisBehindLatest"]);
    });
  });

  describe("props", () => {
    it("accept everything CDK's own StreamConsumerProps accepts (type-level guard)", () => {
      // A re-declared prop must accept everything CDK's own prop accepts
      // (ADR-0018). A `tsc`-only assertion — vitest does not typecheck.
      const _props: StreamConsumerBuilderProps = undefined as unknown as StreamConsumerProps;
    });
  });

  describe("required props", () => {
    it("throws when the stream is missing", () => {
      const stack = new Stack(new App(), "S");
      const builder = createStreamConsumerBuilder().streamConsumerName("alerter");

      expect(() => builder.build(stack, "Consumer")).toThrow(
        /StreamConsumerBuilder "Consumer" requires a stream and a streamConsumerName/,
      );
    });

    it("throws when the streamConsumerName is missing", () => {
      const stack = new Stack(new App(), "S");
      const builder = createStreamConsumerBuilder().stream(new Stream(stack, "Stream"));

      expect(() => builder.build(stack, "Consumer")).toThrow(/requires a stream/);
    });
  });

  describe("stream", () => {
    it("resolves a Resolvable stream from the build context", () => {
      const stack = new Stack(new App(), "S");
      const stream = new Stream(stack, "Upstream");

      const { consumer } = createStreamConsumerBuilder()
        .streamConsumerName("alerter")
        .stream(ref<{ stream: Stream }, Stream>("telemetry", (r) => r.stream))
        .build(stack, "Consumer", { telemetry: { stream } });

      expect(consumer.stream).toBe(stream);
    });
  });

  describe("streamConsumerName constraint (ADR-0010)", () => {
    it("rejects a name with characters outside [a-zA-Z0-9_.-]", () => {
      expect(() => buildAndSynth((b) => b.streamConsumerName("anomaly alerter"))).toThrow(
        /is invalid/,
      );
    });

    it("rejects a name longer than 128 characters", () => {
      expect(() => buildAndSynth((b) => b.streamConsumerName("a".repeat(129)))).toThrow(
        /exceeds the 128-character limit/,
      );
    });
  });

  describe("recommended alarms", () => {
    it("alarms on SubscribeToShardEvent.MillisBehindLatest by default", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Kinesis",
        MetricName: "SubscribeToShardEvent.MillisBehindLatest",
        Statistic: "Average",
        Period: 60,
        Dimensions: Match.arrayEquals([
          {
            Name: "ConsumerName",
            Value: {
              "Fn::GetAtt": [Match.stringLikeRegexp("^TestConsumer"), "ConsumerName"],
            },
          },
          { Name: "StreamName", Value: { Ref: Match.stringLikeRegexp("^Stream") } },
        ]),
        Threshold: 60_000,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
      });
    });

    it("applies an override", () => {
      const { template } = buildAndSynth((b) =>
        b.recommendedAlarms({
          subscribeToShardEventMillisBehindLatest: {
            threshold: 1_000,
            evaluationPeriods: 3,
            datapointsToAlarm: 2,
            treatMissingData: TreatMissingData.BREACHING,
          },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Threshold: 1_000,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
        TreatMissingData: "breaching",
      });
    });

    it.each([
      ["recommendedAlarms(false)", false as const],
      ["enabled: false", { enabled: false }],
      ["the alarm set to false", { subscribeToShardEventMillisBehindLatest: false as const }],
    ])("creates no alarm with %s", (_label, config) => {
      const { result, template } = buildAndSynth((b) => b.recommendedAlarms(config));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("tags", () => {
    it("applies builder tags to the consumer where CDK can tag it", () => {
      const { result, template } = buildAndSynth((b) => b.tag("owner", "platform"));

      // CfnStreamConsumer gained Tags in aws-cdk-lib 2.205.0, above the
      // package floor. Below it, CDK's tag aspect skips the consumer.
      if (TagManager.isTaggableV2(result.consumer.node.defaultChild)) {
        template.hasResourceProperties("AWS::Kinesis::StreamConsumer", {
          Tags: Match.arrayWith([{ Key: "owner", Value: "platform" }]),
        });
      } else {
        template.hasResourceProperties("AWS::Kinesis::StreamConsumer", { Tags: Match.absent() });
      }
    });

    it("applies builder tags to the recommended alarm", () => {
      const { template } = buildAndSynth((b) => b.tag("owner", "platform"));

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Tags: Match.arrayWith([{ Key: "owner", Value: "platform" }]),
      });
    });
  });

  describe("addAlarm", () => {
    it("creates a custom alarm alongside the recommended one", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addAlarm("noRecords", (a) => a.metric(subscribeToShardRate).threshold(1).lessThan()),
      );

      expect(Object.keys(result.alarms).sort()).toEqual([
        "noRecords",
        "subscribeToShardEventMillisBehindLatest",
      ]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "SubscribeToShardEvent.Records",
        ComparisonOperator: "LessThanThreshold",
      });
    });

    it("still creates custom alarms when recommended alarms are disabled", () => {
      const { result } = buildAndSynth((b) =>
        b
          .recommendedAlarms(false)
          .addAlarm("noRecords", (a) => a.metric(subscribeToShardRate).threshold(1).lessThan()),
      );

      expect(Object.keys(result.alarms)).toEqual(["noRecords"]);
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      assertCopyPreservesState({
        factory: () => createStreamConsumerBuilder(),
        configure: (b) => {
          b.recommendedAlarms(false).addAlarm("firstCustom", (a) =>
            a.metric(subscribeToShardRate).threshold(1).lessThan(),
          );
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) => a.metric(subscribeToShardRate).threshold(5).lessThan());
        },
        build: (b) => {
          const stack = new Stack(new App(), "S");
          return b
            .streamConsumerName("alerter")
            .stream(new Stream(stack, "Stream"))
            .build(stack, "Consumer");
        },
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        noRecords: (a) => a.metric(subscribeToShardRate).threshold(1).lessThan(),
        manyRecords: (a) => a.metric(subscribeToShardRate).threshold(100_000),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["noRecords", "manyRecords"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});
