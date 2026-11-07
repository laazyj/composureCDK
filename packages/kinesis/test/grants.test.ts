import { describe, expect, it } from "vitest";

import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Stream, StreamConsumer, StreamEncryption } from "aws-cdk-lib/aws-kinesis";
import { Key } from "aws-cdk-lib/aws-kms";
import { assertCapabilitiesCovered, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { streamConsumerGrants, streamGrants } from "../src/grants.js";

function setup({ withKey = false } = {}) {
  const stack = newStack();
  const stream = new Stream(
    stack,
    "Stream",
    withKey ? { encryption: StreamEncryption.KMS, encryptionKey: new Key(stack, "Key") } : {},
  );
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, stream, role };
}

const CAPABILITIES = [
  ["read", ["kinesis:GetRecords", "kinesis:GetShardIterator"], ["kms:Decrypt"]],
  ["write", ["kinesis:PutRecord", "kinesis:PutRecords"], ["kms:GenerateDataKey*"]],
  [
    "readWrite",
    ["kinesis:GetRecords", "kinesis:PutRecords"],
    ["kms:Decrypt", "kms:GenerateDataKey*"],
  ],
] as const;

describe("streamGrants", () => {
  it("covers every capability streamGrants exposes", () => {
    assertCapabilitiesCovered(streamGrants, CAPABILITIES);
  });

  it.each(CAPABILITIES)("%s delegates to the native grant method", (capability, actions) => {
    const { stack, stream, role } = setup();

    streamGrants[capability](stream).applyTo(role, {});

    const json = policyJson(stack);
    for (const action of actions) expect(json).toContain(action);
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it.each(CAPABILITIES)(
    "%s also grants the customer-managed key's actions",
    (capability, _actions, kmsActions) => {
      const { stack, stream, role } = setup({ withKey: true });

      streamGrants[capability](stream).applyTo(role, {});

      const json = policyJson(stack);
      for (const action of kmsActions) expect(json).toContain(action);
    },
  );

  it("resolves a Resolvable stream from the build context before granting", () => {
    const { stack, stream, role } = setup();

    streamGrants
      .write(ref<{ stream: Stream }, Stream>("telemetry", (r) => r.stream))
      .applyTo(role, { telemetry: { stream } });

    expect(policyJson(stack)).toContain("kinesis:PutRecord");
  });
});

describe("streamConsumerGrants", () => {
  function consumerSetup(options: { withKey?: boolean } = {}) {
    const { stack, stream, role } = setup(options);
    const consumer = new StreamConsumer(stack, "Consumer", {
      streamConsumerName: "alerter",
      stream,
    });
    return { stack, consumer, role };
  }

  it("covers every capability streamConsumerGrants exposes", () => {
    assertCapabilitiesCovered(streamConsumerGrants, ["read"]);
  });

  it("read delegates to the consumer's native grantRead", () => {
    const { stack, consumer, role } = consumerSetup();

    streamConsumerGrants.read(consumer).applyTo(role, {});

    const json = policyJson(stack);
    for (const action of [
      "kinesis:SubscribeToShard",
      "kinesis:DescribeStreamConsumer",
      "kinesis:GetRecords",
    ]) {
      expect(json).toContain(action);
    }
  });

  it("read also grants the stream's customer-managed key", () => {
    const { stack, consumer, role } = consumerSetup({ withKey: true });

    streamConsumerGrants.read(consumer).applyTo(role, {});

    expect(policyJson(stack)).toContain("kms:Decrypt");
  });

  it("resolves a Resolvable consumer from the build context before granting", () => {
    const { stack, consumer, role } = consumerSetup();

    streamConsumerGrants
      .read(ref<{ consumer: StreamConsumer }, StreamConsumer>("alerter", (r) => r.consumer))
      .applyTo(role, { alerter: { consumer } });

    expect(policyJson(stack)).toContain("kinesis:SubscribeToShard");
  });
});
