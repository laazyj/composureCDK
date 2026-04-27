import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { HealthCheckType } from "aws-cdk-lib/aws-route53";
import { createHealthCheckBuilder } from "../src/health-check-builder.js";

const ENV_US_EAST_1 = { account: "123456789012", region: "us-east-1" };

function buildInUsEast1(
  configureFn?: (builder: ReturnType<typeof createHealthCheckBuilder>) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
  const builder = createHealthCheckBuilder().type(HealthCheckType.HTTPS).fqdn("api.example.com");
  configureFn?.(builder);
  const result = builder.build(stack, "ApiHealthCheck");
  return { app, stack, result, template: Template.fromStack(stack) };
}

describe("createHealthCheckBuilder", () => {
  describe("defaults", () => {
    it("creates a Route 53 health check with merged AWS-recommended defaults", () => {
      const { result, template } = buildInUsEast1();

      expect(result.healthCheck).toBeDefined();
      template.hasResourceProperties("AWS::Route53::HealthCheck", {
        HealthCheckConfig: Match.objectLike({
          Type: "HTTPS",
          FullyQualifiedDomainName: "api.example.com",
          FailureThreshold: 3,
          RequestInterval: 30,
          MeasureLatency: true,
        }),
      });
    });

    it("requires a type", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
      const builder = createHealthCheckBuilder().fqdn("api.example.com");
      expect(() => builder.build(stack, "ApiHealthCheck")).toThrow(/requires a type/);
    });

    it("user overrides take precedence over defaults", () => {
      const { template } = buildInUsEast1((b) => {
        b.failureThreshold(5).measureLatency(false);
      });

      template.hasResourceProperties("AWS::Route53::HealthCheck", {
        HealthCheckConfig: Match.objectLike({
          FailureThreshold: 5,
          MeasureLatency: false,
        }),
      });
    });
  });

  describe("region warning", () => {
    function buildInRegion(
      region: string | undefined,
      configureFn?: (builder: ReturnType<typeof createHealthCheckBuilder>) => void,
    ) {
      const app = new App();
      const stack =
        region === undefined
          ? new Stack(app, "TestStack")
          : new Stack(app, "TestStack", { env: { account: "123456789012", region } });
      const builder = createHealthCheckBuilder()
        .type(HealthCheckType.HTTPS)
        .fqdn("api.example.com");
      configureFn?.(builder);
      builder.build(stack, "ApiHealthCheck");
      return stack;
    }

    it("emits a warning when the stack is outside us-east-1", () => {
      const stack = buildInRegion("eu-west-1");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "eu-west-1"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("emits no warning when the stack is in us-east-1", () => {
      const stack = buildInRegion("us-east-1");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when the stack region is an unresolved token", () => {
      const stack = buildInRegion(undefined);
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when recommendedAlarms is false and no custom alarms are added", () => {
      const stack = buildInRegion("eu-west-1", (b) => b.recommendedAlarms(false));
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
