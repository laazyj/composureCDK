import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { HealthCheckType, type IHealthCheck } from "aws-cdk-lib/aws-route53";
import { compose, ref } from "@composurecdk/core";
import type { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createHealthCheckBuilder } from "../src/health-check-builder.js";
import {
  createHealthCheckAlarmBuilder,
  type HealthCheckAlarmBuilderResult,
} from "../src/health-check-alarm-builder.js";
import type { HealthCheckBuilderResult } from "../src/health-check-builder.js";

const ACCOUNT = "123456789012";
const ENV_US_EAST_1 = { account: ACCOUNT, region: "us-east-1" };
const ENV_EU_WEST_2 = { account: ACCOUNT, region: "eu-west-2" };

function connectionTimeAlarm(a: AlarmDefinitionBuilder<IHealthCheck>) {
  return a
    .metric(
      (hc) =>
        new Metric({
          namespace: "AWS/Route53",
          metricName: "ConnectionTime",
          dimensionsMap: { HealthCheckId: hc.healthCheckId },
          statistic: "Average",
        }),
    )
    .threshold(2000)
    .greaterThan();
}

function buildHealthCheck() {
  const app = new App();
  const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
  const result = createHealthCheckBuilder()
    .type(HealthCheckType.HTTPS)
    .fqdn("api.example.com")
    .recommendedAlarms(false)
    .build(stack, "ApiHealthCheck");
  return { app, stack, result };
}

describe("createHealthCheckAlarmBuilder", () => {
  describe("with a concrete HealthCheckBuilderResult", () => {
    it("creates the recommended alarm in the alarm builder's scope", () => {
      const { stack, result } = buildHealthCheck();
      const alarmResult = createHealthCheckAlarmBuilder()
        .healthCheck(result)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.healthCheckStatus).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("recommendedAlarms(false) suppresses the recommended alarm", () => {
      const { stack, result } = buildHealthCheck();
      const alarmResult = createHealthCheckAlarmBuilder()
        .healthCheck(result)
        .recommendedAlarms(false)
        .build(stack, "Alarms");

      expect(alarmResult.alarms).toEqual({});
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates custom addAlarm even when recommendedAlarms is false", () => {
      const { stack, result } = buildHealthCheck();
      const alarmResult = createHealthCheckAlarmBuilder()
        .healthCheck(result)
        .recommendedAlarms(false)
        .addAlarm("connectionTime", connectionTimeAlarm)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.connectionTime).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates custom addAlarm alongside recommended alarms", () => {
      const { stack, result } = buildHealthCheck();
      const alarmResult = createHealthCheckAlarmBuilder()
        .healthCheck(result)
        .addAlarm("connectionTime", connectionTimeAlarm)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.connectionTime).toBeDefined();
      expect(alarmResult.alarms.healthCheckStatus).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("throws when healthCheck() was never called", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });
      const builder = createHealthCheckAlarmBuilder();
      expect(() => builder.build(stack, "Alarms")).toThrow(/requires a health check/);
    });
  });

  describe("region warning", () => {
    function buildAlarmsInRegion(region: string | undefined): Stack {
      const app = new App();
      const hcStackProps =
        region === undefined ? undefined : { env: ENV_EU_WEST_2, crossRegionReferences: true };
      const hcStack = new Stack(app, "HcStack", hcStackProps);
      const result = createHealthCheckBuilder()
        .type(HealthCheckType.HTTPS)
        .fqdn("api.example.com")
        .recommendedAlarms(false)
        .build(hcStack, "ApiHealthCheck");

      const alarmStack =
        region === undefined
          ? new Stack(app, "AlarmStack")
          : new Stack(app, "AlarmStack", {
              env: { account: ACCOUNT, region },
              crossRegionReferences: true,
            });
      createHealthCheckAlarmBuilder().healthCheck(result).build(alarmStack, "Alarms");
      return alarmStack;
    }

    it("emits a warning when the alarm stack is outside us-east-1", () => {
      const stack = buildAlarmsInRegion("us-west-2");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "us-west-2"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("emits no warning when the alarm stack is in us-east-1", () => {
      const stack = buildAlarmsInRegion("us-east-1");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when the alarm stack region is an unresolved token", () => {
      const stack = buildAlarmsInRegion(undefined);
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("with a Ref<HealthCheckBuilderResult> through compose", () => {
    it("resolves the health check and creates the same alarm surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack", { env: ENV_US_EAST_1 });

      const system = compose(
        {
          api: createHealthCheckBuilder()
            .type(HealthCheckType.HTTPS)
            .fqdn("api.example.com")
            .recommendedAlarms(false),

          apiAlarms: createHealthCheckAlarmBuilder().healthCheck(
            ref<HealthCheckBuilderResult>("api"),
          ),
        },
        { api: [], apiAlarms: ["api"] },
      );

      const result = system.build(stack, "Test") as {
        api: HealthCheckBuilderResult;
        apiAlarms: HealthCheckAlarmBuilderResult;
      };

      expect(result.api.alarms).toEqual({});
      expect(result.apiAlarms.alarms.healthCheckStatus).toBeDefined();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Route53::HealthCheck", 1);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("routes alarms into a separate stack when withStacks() points apiAlarms elsewhere", () => {
      const app = new App();
      const appStack = new Stack(app, "AppStack", {
        env: ENV_EU_WEST_2,
        crossRegionReferences: true,
      });
      const alarmStack = new Stack(app, "AlarmStack", {
        env: ENV_US_EAST_1,
        crossRegionReferences: true,
      });

      compose(
        {
          api: createHealthCheckBuilder()
            .type(HealthCheckType.HTTPS)
            .fqdn("api.example.com")
            .recommendedAlarms(false),

          apiAlarms: createHealthCheckAlarmBuilder().healthCheck(
            ref<HealthCheckBuilderResult>("api"),
          ),
        },
        { api: [], apiAlarms: ["api"] },
      )
        .withStacks({
          api: appStack,
          apiAlarms: alarmStack,
        })
        .build(app, "MultiRegion");

      const appTemplate = Template.fromStack(appStack);
      const alarmTemplate = Template.fromStack(alarmStack);

      appTemplate.resourceCountIs("AWS::Route53::HealthCheck", 1);
      appTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 0);

      alarmTemplate.resourceCountIs("AWS::Route53::HealthCheck", 0);
      alarmTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 1);

      const warnings = Annotations.fromStack(alarmStack).findWarning(
        "*",
        Match.stringLikeRegexp("Route 53 health-check metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});
