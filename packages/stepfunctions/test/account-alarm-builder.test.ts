import { describe, expect, it } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { assertAssignable, buildFixture, newStack } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import {
  type AccountAlarmBuilderResult,
  createAccountAlarmBuilder,
} from "../src/account-alarm-builder.js";

const buildAndSynth = buildFixture(createAccountAlarmBuilder, "StepFunctionsAccount");

const metricStat = (metricName: string, stat: string, dimensions?: unknown[]) =>
  Match.objectLike({
    MetricStat: {
      Metric: {
        Namespace: "AWS/States",
        MetricName: metricName,
        ...(dimensions ? { Dimensions: dimensions } : {}),
      },
      Period: 60,
      Stat: stat,
    },
  });

describe("createAccountAlarmBuilder", () => {
  it("creates the two alarms AWS publishes thresholds for by default", () => {
    const { result } = buildAndSynth();

    expect(Object.keys(result.alarms)).toEqual(["openExecutions", "openMapRuns"]);
  });

  it("alarms on open executions as a fraction of the account's own limit", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Metrics: Match.arrayWith([
        Match.objectLike({ Expression: "count / limit" }),
        metricStat("OpenExecutionCount", "Maximum"),
        metricStat("OpenExecutionLimit", "Maximum"),
      ]),
      Threshold: 0.1,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("alarms above 900 open Map Runs, AWS's recommendation", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/States",
      MetricName: "ApproximateOpenMapRunCount",
      Dimensions: Match.absent(),
      Statistic: "Maximum",
      Period: 60,
      Threshold: 900,
      TreatMissingData: "notBreaching",
    });
  });

  it("takes thresholdPercent for open executions", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ openExecutions: { thresholdPercent: 0.25, evaluationPeriods: 3 } }),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Metrics: Match.anyValue(),
      Threshold: 0.25,
      EvaluationPeriods: 3,
      AlarmDescription: Match.stringLikeRegexp("exceed 25% of the account's open-execution quota"),
    });
  });

  it("keeps the default fraction when open executions are tuned otherwise", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ openExecutions: { datapointsToAlarm: 2, evaluationPeriods: 3 } }),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Metrics: Match.anyValue(),
      Threshold: 0.1,
      DatapointsToAlarm: 2,
      AlarmDescription: Match.stringLikeRegexp("exceed 10% of"),
    });
  });

  it.each([0, -0.1, 1.5, Number.NaN])("rejects thresholdPercent %s", (thresholdPercent) => {
    expect(() =>
      buildAndSynth((b) => b.recommendedAlarms({ openExecutions: { thresholdPercent } })),
    ).toThrow(/thresholdPercent must be in \(0, 1\]/);
  });

  it("creates the throttling alarms once enabled, above zero", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms({ startExecutionThrottled: {}, stateTransitionThrottled: {} }),
    );

    expect(Object.keys(result.alarms)).toEqual([
      "openExecutions",
      "openMapRuns",
      "startExecutionThrottled",
      "stateTransitionThrottled",
    ]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ThrottledEvents",
      Dimensions: [{ Name: "APIName", Value: "StartExecution" }],
      Statistic: "Sum",
      Threshold: 0,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ThrottledEvents",
      Dimensions: [{ Name: "ServiceMetric", Value: "StateTransition" }],
      Statistic: "Sum",
      Threshold: 0,
    });
  });

  it("requires a threshold for the Map Run backlog", () => {
    expect(() => buildAndSynth((b) => b.recommendedAlarms({ mapRunBacklog: {} }))).toThrow(
      /"mapRunBacklog" alarm has no default threshold/,
    );

    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ mapRunBacklog: { threshold: 50 } }),
    );
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateMapRunBacklogSize",
      Statistic: "Maximum",
      Threshold: 50,
    });
  });

  it("disables single alarms, or all of them", () => {
    expect(
      Object.keys(buildAndSynth((b) => b.recommendedAlarms({ openMapRuns: false })).result.alarms),
    ).toEqual(["openExecutions"]);
    expect(buildAndSynth((b) => b.recommendedAlarms(false)).result.alarms).toEqual({});
    expect(
      buildAndSynth((b) => b.recommendedAlarms({ enabled: false, startExecutionThrottled: {} }))
        .result.alarms,
    ).toEqual({});
  });

  it("adds custom alarms on the account's dimensionless metrics", () => {
    const { result, template } = buildAndSynth((b) =>
      b
        .recommendedAlarms(false)
        .addAlarm("failed", (a) =>
          a.metric((m) => m.metric("ExecutionsFailed", { statistic: "Sum" })).threshold(10),
        ),
    );

    expect(Object.keys(result.alarms)).toEqual(["failed"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/States",
      MetricName: "ExecutionsFailed",
      Dimensions: Match.absent(),
      Period: 60,
      Threshold: 10,
    });
  });

  it("adds several custom alarms with addAlarms", () => {
    const { result } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        failed: (a) => a.metric((m) => m.metric("ExecutionsFailed")).threshold(10),
        aborted: (a) => a.metric((m) => m.metric("ExecutionsAborted")).threshold(10),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["failed", "aborted"]);
  });

  it("preserves custom alarms across copy()", () => {
    const failed = (key: string) => (b: ReturnType<typeof createAccountAlarmBuilder>) =>
      b.addAlarm(key, (a) => a.metric((m) => m.metric("ExecutionsFailed")).threshold(0));
    assertCopyPreservesState({
      factory: () => createAccountAlarmBuilder().recommendedAlarms(false),
      configure: failed("first"),
      mutate: failed("second"),
      build: (b) => b.build(newStack(), "StepFunctionsAccount"),
      inspect: (r) => Object.keys(r.alarms).sort(),
    });
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: AccountAlarmBuilderResult = result;
    const open = typed.alarms.openExecutions;

    assertAssignable<Alarm | undefined, typeof open>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof open>();
    expect(open).toBeDefined();
    // An opt-in alarm is a key too, absent until configured.
    expect(typed.alarms.mapRunBacklog).toBeUndefined();
    // @ts-expect-error -- "openExecution" is not an account alarm key
    expect(typed.alarms.openExecution).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b) =>
      b.addAlarm("failed", (a) => a.metric((m) => m.metric("ExecutionsFailed")).threshold(10)),
    );
    const alarm = ref(
      "stepFunctionsAccount",
      (r: WithCustomAlarms<AccountAlarmBuilderResult, "failed">) => {
        // @ts-expect-error -- "fail" was not declared as a custom key
        expect(r.alarms.fail).toBeUndefined();
        return r.alarms.failed;
      },
    ).resolve({ stepFunctionsAccount: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.failed);
  });
});
