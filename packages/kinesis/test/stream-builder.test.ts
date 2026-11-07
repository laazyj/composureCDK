import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  type IStream,
  StreamEncryption,
  StreamMode,
  type StreamProps,
} from "aws-cdk-lib/aws-kinesis";
import { Key } from "aws-cdk-lib/aws-kms";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createStreamBuilder, type StreamBuilderProps } from "../src/stream-builder.js";

const buildAndSynth = buildFixture(createStreamBuilder, "TestStream");

const incomingRecords = (stream: IStream) => stream.metricIncomingRecords();

describe("StreamBuilder", () => {
  describe("build", () => {
    it("creates exactly one Kinesis stream", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::Kinesis::Stream", 1);
    });

    it("returns the stream and an empty alarms record", () => {
      const { result } = buildAndSynth();

      expect(result.stream).toBeDefined();
      expect(result.alarms).toEqual({});
    });
  });

  describe("props", () => {
    it("accept everything CDK's own StreamProps accepts (type-level guard)", () => {
      // A re-declared prop must accept everything CDK's own prop accepts, so a
      // later re-declaration cannot silently narrow the builder's surface
      // (ADR-0018). A `tsc`-only assertion — vitest does not typecheck.
      const _props: StreamBuilderProps = undefined as unknown as StreamProps;
    });
  });

  describe("defaults", () => {
    it("encrypts with the AWS-managed key, with no region condition", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        StreamEncryption: { EncryptionType: "KMS", KeyId: "alias/aws/kinesis" },
      });
      expect(template.toJSON().Conditions).toBeUndefined();
    });

    it("uses on-demand capacity with no shard count", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        StreamModeDetails: { StreamMode: "ON_DEMAND" },
        ShardCount: Match.absent(),
      });
    });

    it("retains records for 168 hours", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::Kinesis::Stream", { RetentionPeriodHours: 168 });
    });

    it("retains the stream on removal", () => {
      const { template } = buildAndSynth();

      template.hasResource("AWS::Kinesis::Stream", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });

    it("returns no key for the AWS-managed key", () => {
      const { result } = buildAndSynth();

      expect(result.key).toBeUndefined();
    });
  });

  describe("overrides", () => {
    it("forwards the stream name", () => {
      const { template } = buildAndSynth((b) => b.streamName("telemetry"));

      template.hasResourceProperties("AWS::Kinesis::Stream", { Name: "telemetry" });
    });

    it("allows retention to be overridden", () => {
      const { template } = buildAndSynth((b) => b.retentionPeriod(Duration.hours(24)));

      template.hasResourceProperties("AWS::Kinesis::Stream", { RetentionPeriodHours: 24 });
    });

    it("allows encryption to be turned off", () => {
      const { template } = buildAndSynth((b) => b.encryption(StreamEncryption.UNENCRYPTED));

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        StreamEncryption: Match.absent(),
      });
    });

    it("returns the key CDK creates for KMS encryption without a key", () => {
      const { result, template } = buildAndSynth((b) => b.encryption(StreamEncryption.KMS));

      expect(result.key).toBe(result.stream.encryptionKey);
      expect(result.key).toBeDefined();
      template.resourceCountIs("AWS::KMS::Key", 1);
    });
  });

  describe("shardCount yields the ON_DEMAND default (ADR-0009)", () => {
    it("implies provisioned capacity", () => {
      const { template } = buildAndSynth((b) => b.shardCount(4));

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        ShardCount: 4,
        StreamModeDetails: { StreamMode: "PROVISIONED" },
      });
    });

    it("keeps an explicit streamMode", () => {
      const { template } = buildAndSynth((b) => b.streamMode(StreamMode.PROVISIONED).shardCount(2));

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        ShardCount: 2,
        StreamModeDetails: { StreamMode: "PROVISIONED" },
      });
    });

    it("leaves a conflicting explicit pair for CDK to reject", () => {
      expect(() => buildAndSynth((b) => b.streamMode(StreamMode.ON_DEMAND).shardCount(2))).toThrow(
        /shardCount/,
      );
    });
  });

  describe("encryptionKey yields the MANAGED default (ADR-0009)", () => {
    it("implies KMS encryption with the supplied key and returns it", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      const result = createStreamBuilder().encryptionKey(key).build(stack, "TestStream");

      Template.fromStack(stack).hasResourceProperties("AWS::Kinesis::Stream", {
        StreamEncryption: {
          EncryptionType: "KMS",
          KeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
        },
      });
      expect(result.key).toBe(key);
    });

    it("resolves a Resolvable key from the build context", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      const result = createStreamBuilder()
        .encryptionKey(ref<{ key: Key }, Key>("streamKey", (r) => r.key))
        .build(stack, "TestStream", { streamKey: { key } });

      Template.fromStack(stack).hasResourceProperties("AWS::Kinesis::Stream", {
        StreamEncryption: { KeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] } },
      });
      expect(result.key).toBe(key);
    });

    it("keeps an explicit encryption", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      createStreamBuilder()
        .encryption(StreamEncryption.KMS)
        .encryptionKey(key)
        .build(stack, "TestStream");

      Template.fromStack(stack).hasResourceProperties("AWS::Kinesis::Stream", {
        StreamEncryption: { EncryptionType: "KMS" },
      });
    });

    it("leaves a conflicting explicit pair for CDK to reject", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      expect(() =>
        createStreamBuilder()
          .encryption(StreamEncryption.MANAGED)
          .encryptionKey(key)
          .build(stack, "TestStream"),
      ).toThrow(/encryptionKey/);
    });
  });

  describe("streamName constraint (ADR-0010)", () => {
    it("rejects a name with characters outside [a-zA-Z0-9_.-]", () => {
      expect(() => buildAndSynth((b) => b.streamName("telemetry stream"))).toThrow(/is invalid/);
    });

    it("rejects a name longer than 128 characters", () => {
      expect(() => buildAndSynth((b) => b.streamName("a".repeat(129)))).toThrow(
        /exceeds the 128-character limit/,
      );
    });
  });

  describe("tags", () => {
    it("applies builder tags to the stream", () => {
      const { template } = buildAndSynth((b) => b.tag("owner", "platform"));

      template.hasResourceProperties("AWS::Kinesis::Stream", {
        Tags: Match.arrayWith([{ Key: "owner", Value: "platform" }]),
      });
    });
  });

  describe("addAlarm", () => {
    it("creates a custom alarm using the supplied metric and threshold", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addAlarm("noIncomingRecords", (a) =>
          a.metric(incomingRecords).threshold(1).lessThan().description("No records arriving."),
        ),
      );

      expect(Object.keys(result.alarms)).toEqual(["noIncomingRecords"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "IncomingRecords",
        Namespace: "AWS/Kinesis",
        Threshold: 1,
        ComparisonOperator: "LessThanThreshold",
      });
    });

    it("still creates custom alarms when recommended alarms are disabled", () => {
      const { result } = buildAndSynth((b) =>
        b
          .recommendedAlarms(false)
          .addAlarm("noIncomingRecords", (a) => a.metric(incomingRecords).threshold(1).lessThan()),
      );

      expect(Object.keys(result.alarms)).toEqual(["noIncomingRecords"]);
    });
  });

  describe("copy", () => {
    it("preserves custom alarms across .copy()", () => {
      assertCopyPreservesState({
        factory: () => createStreamBuilder(),
        configure: (b) => {
          b.addAlarm("firstCustom", (a) => a.metric(incomingRecords).threshold(1).lessThan());
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) => a.metric(incomingRecords).threshold(5).lessThan());
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Stream"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
