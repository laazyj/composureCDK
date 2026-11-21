import { describe, expect, it } from "vitest";
import { Duration, type Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Pass, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { Construct } from "constructs";
import { assertAssignable, buildFixture } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { INAPPLICABLE_ALARM_CONFIG_WARNING_ID } from "../src/index.js";
import {
  createStateMachineBuilder,
  type StateMachineBuilderResult,
} from "../src/state-machine-builder.js";

const buildAndSynth = buildFixture(
  () =>
    createStateMachineBuilder()
      .definition((scope: Construct) => new Pass(scope, "PassThrough"))
      .timeout(Duration.minutes(5)),
  "Workflow",
);

const RECOMMENDED = [
  ["executionsFailed", "ExecutionsFailed"],
  ["executionsTimedOut", "ExecutionsTimedOut"],
  ["executionThrottled", "ExecutionThrottled"],
] as const;

describe("state machine alarms", () => {
  it("creates every recommended alarm for a Standard state machine", () => {
    const { result } = buildAndSynth();

    expect(Object.keys(result.alarms).sort()).toEqual(RECOMMENDED.map(([key]) => key).sort());
  });

  it.each(RECOMMENDED)(
    "%s alarms on the first occurrence of AWS/States %s per minute",
    (_key, metricName) => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/States",
        MetricName: metricName,
        Statistic: "Sum",
        Period: 60,
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Dimensions: [{ Name: "StateMachineArn", Value: Match.anyValue() }],
      });
    },
  );

  it("omits the throttle alarm for an Express state machine, whose transitions are not throttled", () => {
    const { result, stack } = buildAndSynth((b) => b.stateMachineType(StateMachineType.EXPRESS));

    expect(Object.keys(result.alarms).sort()).toEqual(["executionsFailed", "executionsTimedOut"]);
    // Left unset, the inapplicable alarm is dropped without a warning.
    expect(
      Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp(INAPPLICABLE_ALARM_CONFIG_WARNING_ID),
      ),
    ).toHaveLength(0);
  });

  describe("configuring an alarm that cannot apply", () => {
    const inapplicable = (stack: Stack) =>
      Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp(INAPPLICABLE_ALARM_CONFIG_WARNING_ID),
      );

    it("warns when executionThrottled is tuned on an Express state machine", () => {
      const { stack, result } = buildAndSynth((b) =>
        b
          .stateMachineType(StateMachineType.EXPRESS)
          .recommendedAlarms({ executionThrottled: { threshold: 5 } }),
      );

      expect(result.alarms.executionThrottled).toBeUndefined();
      expect(inapplicable(stack)).toHaveLength(1);
    });

    it("does not warn when it is disabled", () => {
      const { stack } = buildAndSynth((b) =>
        b
          .stateMachineType(StateMachineType.EXPRESS)
          .recommendedAlarms({ executionThrottled: false }),
      );

      expect(inapplicable(stack)).toHaveLength(0);
    });
  });

  it("tunes an alarm, keeping the rest of its defaults", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ executionsFailed: { threshold: 5, evaluationPeriods: 3 } }),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ExecutionsFailed",
      Threshold: 5,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 1,
    });
  });

  it("disables one alarm", () => {
    const { result } = buildAndSynth((b) => b.recommendedAlarms({ executionsTimedOut: false }));

    expect(Object.keys(result.alarms).sort()).toEqual(["executionThrottled", "executionsFailed"]);
  });

  it.each([false, { enabled: false }] as const)(
    "disables every recommended alarm with %o",
    (config) => {
      const { template } = buildAndSynth((b) => b.recommendedAlarms(config));

      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    },
  );

  it("adds a custom alarm alongside the recommended ones, even with those disabled", () => {
    const { result, template } = buildAndSynth((b) =>
      b
        .recommendedAlarms(false)
        .addAlarm("aborted", (a) =>
          a.metric((sm) => sm.metricAborted({ period: Duration.minutes(1) })).threshold(0),
        ),
    );

    expect(Object.keys(result.alarms)).toEqual(["aborted"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", { MetricName: "ExecutionsAborted" });
  });

  it("preserves custom alarms across copy()", () => {
    const aborted = (key: string) => (b: ReturnType<typeof createStateMachineBuilder>) =>
      b.addAlarm(key, (a) => a.metric((sm) => sm.metricAborted()).threshold(0));
    assertCopyPreservesState({
      factory: () =>
        createStateMachineBuilder()
          .definition((scope: Construct) => new Pass(scope, "P"))
          .timeout(Duration.minutes(1))
          .recommendedAlarms(false),
      configure: aborted("first"),
      mutate: aborted("second"),
      build: (b) => buildFixture(() => b, "Workflow")().result,
      inspect: (r) => Object.keys(r.alarms).sort(),
    });
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        aborted: (a) => a.metric((sm) => sm.metricAborted()).threshold(0),
        throttled: (a) => a.metric((sm) => sm.metricThrottled()).threshold(0),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["aborted", "throttled"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: StateMachineBuilderResult = result;
    const failed = typed.alarms.executionsFailed;

    assertAssignable<Alarm | undefined, typeof failed>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof failed>();
    expect(failed).toBeDefined();
    // @ts-expect-error -- "executionFailed" is not a state machine alarm key
    expect(typed.alarms.executionFailed).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b) =>
      b.addAlarm("aborted", (a) => a.metric((sm) => sm.metricAborted()).threshold(0)),
    );
    const alarm = ref("workflow", (r: WithCustomAlarms<StateMachineBuilderResult, "aborted">) => {
      // @ts-expect-error -- "abort" was not declared as a custom key
      expect(r.alarms.abort).toBeUndefined();
      return r.alarms.aborted;
    }).resolve({ workflow: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.aborted);
  });
});
