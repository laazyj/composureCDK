import { describe, expect, it } from "vitest";
import { Duration } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type IRole, Role } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createMemoryBuilder } from "../src/memory-builder.js";

const buildAndSynth = buildFixture(() => createMemoryBuilder().memoryName("support"), "Memory");

describe("createMemoryBuilder", () => {
  it("keeps CDK's defaults: short-term memory for 90 days", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::BedrockAgentCore::Memory", {
      Name: "support",
      EventExpiryDuration: 90,
      EncryptionKeyArn: Match.absent(),
      MemoryStrategies: Match.absent(),
    });
  });

  it("passes props through", () => {
    const { template } = buildAndSynth((b) => b.expirationDuration(Duration.days(30)));

    template.hasResourceProperties("AWS::BedrockAgentCore::Memory", { EventExpiryDuration: 30 });
  });

  it("encrypts with a customer managed key from the build context", () => {
    const stack = newStack();
    const key = new Key(stack, "Key");
    const { memory } = createMemoryBuilder()
      .kmsKey(ref<{ key: Key }>("key").get("key"))
      .build(stack, "Memory", { key: { key } });

    expect(memory.kmsKey).toBe(key);
  });

  it("uses a supplied execution role from the build context", () => {
    const stack = newStack();
    const role = Role.fromRoleName(stack, "Imported", "memory-role");
    const { memory } = createMemoryBuilder()
      .executionRole(ref<{ role: IRole }>("iam").get("role"))
      .build(stack, "Memory", { iam: { role } });

    expect(memory.executionRole).toBe(role);
  });

  describe("alarms", () => {
    it("creates no recommended alarms", () => {
      const { result, template } = buildAndSynth();

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("adds custom alarms on a per-operation metric", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addAlarm("writeErrors", (a) =>
          a
            .metric((m) => m.metric("Errors", { dimensionsMap: { Operation: "CreateEvent" } }))
            .threshold(0)
            .greaterThan(),
        ),
      );

      expect(Object.keys(result.alarms)).toEqual(["writeErrors"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Period: 60,
        Dimensions: Match.arrayWith([{ Name: "Operation", Value: "CreateEvent" }]),
      });
    });

    it("copies custom alarms independently", () => {
      const base = createMemoryBuilder();
      const copy = base.copy().addAlarm("events", (a) =>
        a
          .metric((m) => m.metric("CreationCount"))
          .threshold(1)
          .greaterThan(),
      );

      expect(Object.keys(base.build(newStack(), "Memory").alarms)).toEqual([]);
      expect(Object.keys(copy.build(newStack(), "Memory").alarms)).toEqual(["events"]);
    });
  });

  it("tags the memory", () => {
    const { template } = buildAndSynth((b) => b.tag("Project", "support"));

    template.hasResourceProperties("AWS::BedrockAgentCore::Memory", {
      Tags: { Project: "support" },
    });
  });
});
