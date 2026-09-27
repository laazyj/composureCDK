import { describe, it, expect } from "vitest";
import { RemovalPolicy } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { type LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createLogGroupBuilder, type LogGroupBuilderProps } from "../src/log-group-builder.js";

const buildAndSynth = buildFixture(createLogGroupBuilder, "TestLogGroup");

describe("LogGroupBuilder", () => {
  describe("build", () => {
    it("returns a LogGroupBuilderResult with a logGroup property", () => {
      const { result } = buildAndSynth();

      expect(result).toBeDefined();
      expect(result.logGroup).toBeDefined();
    });
  });

  describe("props", () => {
    it("accept everything CDK's own LogGroupProps accepts (type-level guard)", () => {
      // A re-declared prop must accept everything CDK's own prop accepts, so a
      // later re-declaration cannot silently narrow the builder's surface
      // (ADR-0018) — CDK has already widened `encryptionKey` to `kms.IKeyRef`
      // here. A `tsc`-only assertion — vitest does not typecheck.
      const _props: LogGroupBuilderProps = undefined as unknown as LogGroupProps;
    });
  });

  describe("synthesised output", () => {
    it("creates exactly one log group", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates a log group with a custom name", () => {
      const { template } = buildAndSynth((b) => b.logGroupName("/my-app/logs"));

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/my-app/logs",
      });
    });
  });

  describe("secure defaults", () => {
    it("sets two-year retention by default", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("retains the log group on stack deletion by default", () => {
      const { template } = buildAndSynth();

      const logGroups = template.findResources("AWS::Logs::LogGroup");
      const logGroup = Object.values(logGroups)[0];
      expect(logGroup.DeletionPolicy).toBe("Retain");
      expect(logGroup.UpdateReplacePolicy).toBe("Retain");
    });

    it("allows the user to override retention", () => {
      const { template } = buildAndSynth((b) => b.retention(RetentionDays.SIX_MONTHS));

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 180,
      });
    });

    it("allows the user to override removal policy", () => {
      const { template } = buildAndSynth((b) => b.removalPolicy(RemovalPolicy.DESTROY));

      const logGroups = template.findResources("AWS::Logs::LogGroup");
      const logGroup = Object.values(logGroups)[0];
      expect(logGroup.DeletionPolicy).toBe("Delete");
    });
  });

  describe("encryptionKey", () => {
    it("passes a concrete key through to the log group", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      createLogGroupBuilder().encryptionKey(key).build(stack, "TestLogGroup");

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
      });
    });

    it("resolves a Resolvable key from the build context", () => {
      const stack = newStack();
      const key = new Key(stack, "Key");

      createLogGroupBuilder()
        .encryptionKey(ref<{ key: Key }, Key>("logKey", (r) => r.key))
        .build(stack, "TestLogGroup", { logKey: { key } });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        KmsKeyId: { "Fn::GetAtt": ["Key961B73FD", "Arn"] },
      });
    });
  });
});
