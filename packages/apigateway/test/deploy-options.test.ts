import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { LogGroupLogDestination, MethodLoggingLevel } from "aws-cdk-lib/aws-apigateway";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { DEPLOY_OPTIONS_DEFAULTS } from "../src/defaults.js";
import { resolveDeployOptions } from "../src/deploy-options.js";

function buildInStack(accessLogging: boolean | undefined, userDeployOptions = {}) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const result = resolveDeployOptions(
    stack,
    "Test",
    accessLogging,
    DEPLOY_OPTIONS_DEFAULTS,
    userDeployOptions,
  );
  return { stack, result };
}

describe("resolveDeployOptions", () => {
  describe("access logging", () => {
    it("creates an access log group by default", () => {
      const { result } = buildInStack(undefined);

      expect(result.accessLogGroup).toBeDefined();
    });

    it("creates an access log group when explicitly enabled", () => {
      const { result } = buildInStack(true);

      expect(result.accessLogGroup).toBeDefined();
    });

    it("does not create an access log group when disabled", () => {
      const { result } = buildInStack(false);

      expect(result.accessLogGroup).toBeUndefined();
    });

    it("does not create an access log group when user provides their own destination", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const result = resolveDeployOptions(stack, "Test", undefined, DEPLOY_OPTIONS_DEFAULTS, {
        accessLogDestination: new LogGroupLogDestination(userLogGroup),
      });

      expect(result.accessLogGroup).toBeUndefined();
    });

    it("configures JSON-formatted access log output", () => {
      const { stack } = buildInStack(true);
      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 731,
      });
    });

    it("includes accessLogDestination in deploy options when enabled", () => {
      const { result } = buildInStack(true);

      expect(result.deployOptions.accessLogDestination).toBeDefined();
      expect(result.deployOptions.accessLogFormat).toBeDefined();
    });

    it("does not include accessLogDestination in deploy options when disabled", () => {
      const { result } = buildInStack(false);

      expect(result.deployOptions.accessLogDestination).toBeUndefined();
      expect(result.deployOptions.accessLogFormat).toBeUndefined();
    });
  });

  describe("defaults merging", () => {
    it("applies provided defaults to deploy options", () => {
      const { result } = buildInStack(false);

      expect(result.deployOptions.tracingEnabled).toBe(true);
      expect(result.deployOptions.loggingLevel).toBe(MethodLoggingLevel.INFO);
      expect(result.deployOptions.dataTraceEnabled).toBe(false);
    });

    it("uses custom defaults when provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const customDefaults = { tracingEnabled: false, dataTraceEnabled: true };
      const result = resolveDeployOptions(stack, "Test", false, customDefaults, {});

      expect(result.deployOptions.tracingEnabled).toBe(false);
      expect(result.deployOptions.dataTraceEnabled).toBe(true);
    });
  });

  describe("user overrides", () => {
    it("allows user to override tracing", () => {
      const { result } = buildInStack(false, { tracingEnabled: false });

      expect(result.deployOptions.tracingEnabled).toBe(false);
    });

    it("allows user to override logging level", () => {
      const { result } = buildInStack(false, {
        loggingLevel: MethodLoggingLevel.ERROR,
      });

      expect(result.deployOptions.loggingLevel).toBe(MethodLoggingLevel.ERROR);
    });

    it("allows user to set a stage name", () => {
      const { result } = buildInStack(false, { stageName: "live" });

      expect(result.deployOptions.stageName).toBe("live");
    });

    it("preserves defaults for fields the user does not override", () => {
      const { result } = buildInStack(false, { stageName: "live" });

      expect(result.deployOptions.tracingEnabled).toBe(true);
      expect(result.deployOptions.loggingLevel).toBe(MethodLoggingLevel.INFO);
      expect(result.deployOptions.dataTraceEnabled).toBe(false);
    });

    it("user-provided accessLogDestination takes precedence over auto-created one", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const userLogGroup = new LogGroup(stack, "UserLogGroup");
      const userDestination = new LogGroupLogDestination(userLogGroup);
      const result = resolveDeployOptions(stack, "Test", true, DEPLOY_OPTIONS_DEFAULTS, {
        accessLogDestination: userDestination,
      });

      expect(result.accessLogGroup).toBeUndefined();
      expect(result.deployOptions.accessLogDestination).toBe(userDestination);
    });
  });
});
