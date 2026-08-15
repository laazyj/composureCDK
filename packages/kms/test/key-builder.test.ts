import { describe, it, expect } from "vitest";
import { App, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { type IKey, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import type { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createKeyBuilder } from "../src/key-builder.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack");
}

/** A minimal, fully-configured custom alarm on the key's own expiry metric. */
function expiryAlarm(
  alarm: AlarmDefinitionBuilder<IKey>,
  threshold: number,
): AlarmDefinitionBuilder<IKey> {
  return alarm
    .metric(
      (key) =>
        new Metric({
          namespace: "AWS/KMS",
          metricName: "SecondsUntilKeyMaterialExpiration",
          dimensionsMap: { KeyId: key.keyId },
          statistic: "Minimum",
          period: Duration.hours(6),
        }),
    )
    .threshold(threshold)
    .lessThanOrEqual()
    .description("Key material about to expire");
}

function build(configureFn?: (builder: ReturnType<typeof createKeyBuilder>) => void): Template {
  const stack = newStack();
  const builder = createKeyBuilder();
  configureFn?.(builder);
  builder.build(stack, "TestKey");
  return Template.fromStack(stack);
}

describe("KeyBuilder", () => {
  describe("build", () => {
    it("returns a KeyBuilderResult carrying the key", () => {
      const result = createKeyBuilder().build(newStack(), "TestKey");

      expect(result.key).toBeDefined();
      expect(result.alias).toBeUndefined();
      expect(result.alarms).toEqual({});
    });

    it("creates an AWS::KMS::Key", () => {
      const template = build();

      template.resourceCountIs("AWS::KMS::Key", 1);
    });

    it("passes configured props through to the key", () => {
      const template = build((b) => b.description("Encrypts the orders table."));

      template.hasResourceProperties("AWS::KMS::Key", {
        Description: "Encrypts the orders table.",
      });
    });
  });

  describe("defaults", () => {
    it("enables key rotation", () => {
      const template = build();

      template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
    });

    it("uses the maximum 30-day pending deletion window", () => {
      const template = build();

      template.hasResourceProperties("AWS::KMS::Key", { PendingWindowInDays: 30 });
    });

    it("retains the key on stack deletion", () => {
      const template = build();

      template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Retain" });
    });

    it.each([
      [
        "enableKeyRotation",
        (b: ReturnType<typeof createKeyBuilder>) => b.enableKeyRotation(false),
        { EnableKeyRotation: false },
      ],
      [
        "pendingWindow",
        (b: ReturnType<typeof createKeyBuilder>) => b.pendingWindow(Duration.days(7)),
        { PendingWindowInDays: 7 },
      ],
    ] as const)("lets the user override the %s default", (_name, configure, expected) => {
      const template = build((b) => {
        configure(b);
      });

      template.hasResourceProperties("AWS::KMS::Key", expected);
    });

    it("lets the user override the removalPolicy default", () => {
      const template = build((b) => b.removalPolicy(RemovalPolicy.DESTROY));

      template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Delete" });
    });

    it("drops the rotation default for a key spec that cannot rotate", () => {
      const template = build((b) => b.keySpec(KeySpec.RSA_4096).keyUsage(KeyUsage.SIGN_VERIFY));

      template.hasResourceProperties("AWS::KMS::Key", {
        KeySpec: "RSA_4096",
        EnableKeyRotation: Match.absent(),
      });
    });

    it("keeps the rotation default when the key spec is explicitly symmetric", () => {
      const template = build((b) => b.keySpec(KeySpec.SYMMETRIC_DEFAULT));

      template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
    });

    it("leaves an explicit rotation request on a non-rotatable spec for CDK to reject", () => {
      expect(() =>
        createKeyBuilder()
          .keySpec(KeySpec.RSA_4096)
          .keyUsage(KeyUsage.SIGN_VERIFY)
          .enableKeyRotation(true)
          .build(newStack(), "TestKey"),
      ).toThrow(/rotation cannot be enabled on asymmetric keys/);
    });
  });

  describe("alias", () => {
    it("creates an alias and returns it in the result", () => {
      const stack = newStack();
      const result = createKeyBuilder().alias("orders/table").build(stack, "TestKey");

      expect(result.alias).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::KMS::Alias", { AliasName: "alias/orders/table" });
      template.resourceCountIs("AWS::KMS::Alias", 1);
    });
  });

  describe("tags", () => {
    it("applies builder tags to the key", () => {
      const template = build((b) => b.tag("owner", "platform"));

      template.hasResourceProperties("AWS::KMS::Key", {
        Tags: Match.arrayWith([{ Key: "owner", Value: "platform" }]),
      });
    });
  });

  describe("alarms", () => {
    it("creates no alarms by default", () => {
      const template = build();

      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates the key material expiration alarm when opted in", () => {
      const template = build((b) => b.recommendedAlarms({ keyMaterialExpiration: true }));

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/KMS",
        MetricName: "SecondsUntilKeyMaterialExpiration",
        Statistic: "Minimum",
        Period: 3600,
        Threshold: 2592000,
        ComparisonOperator: "LessThanOrEqualToThreshold",
        TreatMissingData: "ignore",
      });
    });

    it("returns the created alarm in the result", () => {
      const result = createKeyBuilder()
        .recommendedAlarms({ keyMaterialExpiration: true })
        .build(newStack(), "TestKey");

      expect(Object.keys(result.alarms)).toEqual(["keyMaterialExpiration"]);
    });

    it("applies threshold overrides", () => {
      const template = build((b) =>
        b.recommendedAlarms({ keyMaterialExpiration: { threshold: 604800 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", { Threshold: 604800 });
    });

    it.each([
      ["the alarm set is disabled wholesale", { enabled: false, keyMaterialExpiration: true }],
      ["the individual alarm is disabled", { keyMaterialExpiration: false }],
    ] as const)("creates no recommended alarm when %s", (_name, config) => {
      const template = build((b) => b.recommendedAlarms(config));

      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates no recommended alarm when recommendedAlarms is false", () => {
      const template = build((b) => b.recommendedAlarms(false));

      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates custom alarms added via addAlarm", () => {
      const template = build((b) => b.addAlarm("urgentExpiry", (alarm) => expiryAlarm(alarm, 1)));

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmDescription: "Key material about to expire",
        Period: 21600,
      });
    });

    it("keeps custom alarms across .copy()", () => {
      assertCopyPreservesState({
        factory: () => createKeyBuilder(),
        configure: (b) => b.addAlarm("first", (alarm) => expiryAlarm(alarm, 1)),
        mutate: (b) => b.addAlarm("second", (alarm) => expiryAlarm(alarm, 2)),
        build: (b) => b.build(newStack(), "TestKey"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
