import { describe, it, expect } from "vitest";
import { App, CfnParameter, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import {
  resolveQuotaAlarm,
  resolveThresholdAlarms,
  SUSTAINED_ALARM_DEFAULTS,
  type ThresholdAlarmSpec,
} from "../src/threshold-alarms.js";

const metric = (metricName: string, statistic = "Sum") =>
  new Metric({ namespace: "Test", metricName, statistic });

const SPECS: Record<"errors" | "latency", ThresholdAlarmSpec> = {
  errors: {
    metricName: "Errors",
    statistic: "Sum",
    defaults: { threshold: 0, ...SUSTAINED_ALARM_DEFAULTS },
    describe: (t) => `errors > ${String(t)}`,
  },
  latency: {
    metricName: "Latency",
    statistic: "p90",
    describe: (t) => `latency > ${String(t)}`,
  },
};

describe("resolveThresholdAlarms", () => {
  it("creates on-by-default alarms and skips unconfigured opt-in ones", () => {
    const [errors, ...rest] = resolveThresholdAlarms(SPECS, undefined, metric);

    expect(rest).toEqual([]);
    expect(errors).toMatchObject({
      key: "errors",
      threshold: 0,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      description: "errors > 0",
    });
  });

  it("creates an opt-in alarm with the sustained shape when given a threshold", () => {
    const defs = resolveThresholdAlarms(
      SPECS,
      { errors: false, latency: { threshold: 500 } },
      metric,
    );

    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ key: "latency", threshold: 500, evaluationPeriods: 5 });
    expect((defs[0].metric as Metric).statistic).toBe("p90");
  });

  it("throws for an opt-in alarm without a threshold", () => {
    expect(() => resolveThresholdAlarms(SPECS, { latency: {} }, metric)).toThrow(
      /"latency" alarm has no default threshold/,
    );
  });
});

describe("resolveQuotaAlarm", () => {
  const options = (stack: Stack) => ({
    scope: stack,
    key: "usage",
    metric: () => metric("Usage", "Maximum"),
    defaultThresholdPercent: 0.8,
    warningId: "@composurecdk/test:quota",
    alarmLabel: "test quota",

    describe: (quota: number, percent: number) => `${String(percent)} of ${String(quota)}`,
  });

  it("creates no alarm when unconfigured", () => {
    const stack = new Stack(new App(), "S");
    expect(resolveQuotaAlarm({ ...options(stack), config: undefined })).toEqual([]);
    expect(resolveQuotaAlarm({ ...options(stack), config: false })).toEqual([]);
  });

  it("alarms at the default fraction of the quota", () => {
    const stack = new Stack(new App(), "S");
    const [def] = resolveQuotaAlarm({ ...options(stack), config: { quota: 1000 } });

    expect(def).toMatchObject({ key: "usage", threshold: 800, description: "0.8 of 1000" });
  });

  it("honours thresholdPercent", () => {
    const stack = new Stack(new App(), "S");
    const [def] = resolveQuotaAlarm({
      ...options(stack),
      config: { quota: 1000, thresholdPercent: 0.5 },
    });

    expect(def.threshold).toBe(500);
  });

  it("warns and skips the alarm when the quota is a token", () => {
    const stack = new Stack(new App(), "S");
    const quota = new CfnParameter(stack, "Quota", { type: "Number" }).valueAsNumber;

    expect(resolveQuotaAlarm({ ...options(stack), config: { quota } })).toEqual([]);
    Annotations.fromStack(stack).hasWarning("*", Match.stringLikeRegexp("test quota"));
  });

  it.each([
    [{ quota: 0 }, /quota must be a positive number/],
    [{ quota: 10, thresholdPercent: 1.5 }, /thresholdPercent must be in/],
  ])("rejects %o", (config, message) => {
    const stack = new Stack(new App(), "S");
    expect(() => resolveQuotaAlarm({ ...options(stack), config })).toThrow(message);
  });
});
