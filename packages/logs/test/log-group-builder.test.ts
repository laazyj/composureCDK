import { describe, it, expect } from "vitest";
import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { createLogGroupBuilder } from "../src/log-group-builder.js";

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createLogGroupBuilder>) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createLogGroupBuilder();
  configureFn(builder);
  builder.build(stack, "TestLogGroup");
  return Template.fromStack(stack);
}

describe("LogGroupBuilder", () => {
  describe("build", () => {
    it("returns a LogGroupBuilderResult with a logGroup property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createLogGroupBuilder();

      const result = builder.build(stack, "TestLogGroup");

      expect(result).toBeDefined();
      expect(result.logGroup).toBeDefined();
    });
  });

  describe("synthesised output", () => {
    it("creates exactly one log group", () => {
      const template = synthTemplate(() => {
        // use defaults only
      });

      template.resourceCountIs("AWS::Logs::LogGroup", 1);
    });

    it("creates a log group with a custom name", () => {
      const template = synthTemplate((b) => b.logGroupName("/my-app/logs"));

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/my-app/logs",
      });
    });
  });

  describe("secure defaults", () => {
    it("sets two-year retention by default", () => {
      const template = synthTemplate(() => {
        // use defaults only
      });

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("retains the log group on stack deletion by default", () => {
      const template = synthTemplate(() => {
        // use defaults only
      });

      const logGroups = template.findResources("AWS::Logs::LogGroup");
      const logGroup = Object.values(logGroups)[0];
      expect(logGroup.DeletionPolicy).toBe("Retain");
      expect(logGroup.UpdateReplacePolicy).toBe("Retain");
    });

    it("allows the user to override retention", () => {
      const template = synthTemplate((b) => b.retention(RetentionDays.SIX_MONTHS));

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 180,
      });
    });

    it("allows the user to override removal policy", () => {
      const template = synthTemplate((b) => b.removalPolicy(RemovalPolicy.DESTROY));

      const logGroups = template.findResources("AWS::Logs::LogGroup");
      const logGroup = Object.values(logGroups)[0];
      expect(logGroup.DeletionPolicy).toBe("Delete");
    });
  });
});
