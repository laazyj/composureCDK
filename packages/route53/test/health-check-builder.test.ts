import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { HealthCheckType, type IHealthCheck } from "aws-cdk-lib/aws-route53";
import { buildFixture, newStack, testEnv } from "@composurecdk/cdk-testing";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createHealthCheckBuilder } from "../src/health-check-builder.js";

const buildAndSynth = buildFixture(
  () => createHealthCheckBuilder().type(HealthCheckType.HTTPS).fqdn("api.example.com"),
  "ApiHealthCheck",
  { stackProps: { env: testEnv("us-east-1") } },
);

describe("createHealthCheckBuilder", () => {
  describe("defaults", () => {
    it("creates a Route 53 health check with merged AWS-recommended defaults", () => {
      const { result, template } = buildAndSynth();

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
      const stack = newStack({ env: testEnv("us-east-1") });
      const builder = createHealthCheckBuilder().fqdn("api.example.com");
      expect(() => builder.build(stack, "ApiHealthCheck")).toThrow(/requires a type/);
    });

    it("user overrides take precedence over defaults", () => {
      const { template } = buildAndSynth((b) => {
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
    // `stackProps: {}` replaces the fixture's default env rather than merging,
    // which is how an environment-agnostic stack is spelled.
    const buildInRegion = (
      region: string | undefined,
      configureFn?: (builder: ReturnType<typeof createHealthCheckBuilder>) => void,
    ) => buildAndSynth(configureFn, { stackProps: region ? { env: testEnv(region) } : {} }).stack;

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

  describe("[COPY_STATE]", () => {
    it("preserves #customAlarms across .copy()", () => {
      const connectionTimeMetric = (hc: IHealthCheck): Metric =>
        new Metric({
          namespace: "AWS/Route53",
          metricName: "ConnectionTime",
          dimensionsMap: { HealthCheckId: hc.healthCheckId },
          statistic: "Average",
          period: Duration.minutes(1),
        });

      assertCopyPreservesState({
        factory: () =>
          createHealthCheckBuilder().type(HealthCheckType.HTTPS).fqdn("api.example.com"),
        configure: (b) => {
          b.addAlarm("firstCustom", (a) =>
            a.metric(connectionTimeMetric).threshold(2000).greaterThan(),
          );
        },
        mutate: (b) => {
          b.addAlarm("secondCustom", (a) =>
            a.metric(connectionTimeMetric).threshold(3000).greaterThan(),
          );
        },
        build: (b) =>
          b.build(new Stack(new App(), "S", { env: testEnv("us-east-1") }), "HealthCheck"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
