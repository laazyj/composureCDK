import { describe, it, expect } from "vitest";
import { Duration } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type Alarm, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { HealthCheckType, type IHealthCheck } from "aws-cdk-lib/aws-route53";
import { assertAssignable, buildFixture, testEnv } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import {
  createHealthCheckBuilder,
  type HealthCheckBuilderResult,
} from "../src/health-check-builder.js";
import { resolveHealthCheckAlarmDefinitions } from "../src/health-check-alarms.js";

const buildAndSynth = buildFixture(
  () => createHealthCheckBuilder().type(HealthCheckType.HTTPS).fqdn("api.example.com"),
  "ApiHealthCheck",
  {
    stackProps: { env: testEnv("us-east-1") },
  },
);

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates the healthCheckStatus alarm by default", () => {
      const { result, template } = buildAndSynth();

      expect(result.alarms.healthCheckStatus).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates healthCheckStatus with AWS-recommended threshold and metric shape", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        Namespace: "AWS/Route53",
        Threshold: 1,
        ComparisonOperator: "LessThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "breaching",
        Statistic: "Minimum",
        Period: 60,
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "HealthCheckId" })]),
      });
    });

    it("includes threshold and period in the alarm description", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        AlarmDescription: Match.stringLikeRegexp("HealthCheckStatus < 1.*1 minute"),
      });
    });
  });

  describe("customisation", () => {
    it("honours a custom threshold", () => {
      const { template } = buildAndSynth((b) => {
        b.recommendedAlarms({ healthCheckStatus: { threshold: 0.5 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        Threshold: 0.5,
      });
    });

    it("honours a custom evaluation window", () => {
      const { template } = buildAndSynth((b) => {
        b.recommendedAlarms({
          healthCheckStatus: { evaluationPeriods: 3, datapointsToAlarm: 2 },
        });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
      });
    });

    it("preserves unspecified fields when threshold is overridden", () => {
      const { template } = buildAndSynth((b) => {
        b.recommendedAlarms({ healthCheckStatus: { threshold: 0.5 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        EvaluationPeriods: 1,
        TreatMissingData: "breaching",
      });
    });

    it("disables the healthCheckStatus alarm when set to false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms({ healthCheckStatus: false });
      });

      expect(result.alarms.healthCheckStatus).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("custom alarms", () => {
    it("creates a custom alarm alongside the recommended alarm", () => {
      const { result, template } = buildAndSynth((b) => {
        b.addAlarm("connectionTime", (alarm) =>
          alarm
            .metric(
              (hc: IHealthCheck) =>
                new Metric({
                  namespace: "AWS/Route53",
                  metricName: "ConnectionTime",
                  dimensionsMap: { HealthCheckId: hc.healthCheckId },
                  statistic: "Average",
                  period: Duration.minutes(1),
                }),
            )
            .threshold(2000)
            .greaterThan()
            .description("Health check connection time is high"),
        );
      });

      expect(result.alarms.connectionTime).toBeDefined();
      expect(result.alarms.healthCheckStatus).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("rejects a custom alarm that collides with a recommended alarm key", () => {
      expect(() =>
        buildAndSynth((b) => {
          b.addAlarm("healthCheckStatus", (alarm) =>
            alarm
              .metric(
                (hc: IHealthCheck) =>
                  new Metric({
                    namespace: "AWS/Route53",
                    metricName: "HealthCheckStatus",
                    dimensionsMap: { HealthCheckId: hc.healthCheckId },
                    statistic: "Minimum",
                    period: Duration.minutes(1),
                  }),
              )
              .threshold(1)
              .lessThan(),
          );
        }),
      ).toThrow(/Duplicate alarm key/);
    });
  });

  describe("resolveHealthCheckAlarmDefinitions", () => {
    const fakeHealthCheck = { healthCheckId: "hc-123" } as IHealthCheck;

    it("returns no definitions when config is disabled", () => {
      expect(resolveHealthCheckAlarmDefinitions(fakeHealthCheck, { enabled: false })).toEqual([]);
    });

    it("returns the healthCheckStatus definition when config is undefined", () => {
      const definitions = resolveHealthCheckAlarmDefinitions(fakeHealthCheck, undefined);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]?.key).toBe("healthCheckStatus");
    });
  });

  describe("treatMissingData semantics", () => {
    it("uses BREACHING by default so missing data flags the health check unhealthy", () => {
      const { template } = buildAndSynth();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "HealthCheckStatus",
        TreatMissingData: "breaching",
      });
    });
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types a recommended key as possibly absent and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: HealthCheckBuilderResult = result;
    const status = typed.alarms.healthCheckStatus;

    assertAssignable<Alarm | undefined, typeof status>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof status>();
    expect(status).toBeDefined();
    // @ts-expect-error -- "healthCheckStatu" is not a health-check alarm key
    expect(typed.alarms.healthCheckStatu).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b) => {
      b.addAlarm("connectionTime", (alarm) =>
        alarm
          .metric(
            (hc: IHealthCheck) =>
              new Metric({
                namespace: "AWS/Route53",
                metricName: "ConnectionTime",
                dimensionsMap: { HealthCheckId: hc.healthCheckId },
                statistic: "Average",
              }),
          )
          .threshold(2000)
          .greaterThan(),
      );
    });
    const alarm = ref("api", (r: WithCustomAlarms<HealthCheckBuilderResult, "connectionTime">) => {
      // @ts-expect-error -- "connectTime" was not declared as a custom key
      expect(r.alarms.connectTime).toBeUndefined();
      return r.alarms.connectionTime;
    }).resolve({ api: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.connectionTime);
  });
});
