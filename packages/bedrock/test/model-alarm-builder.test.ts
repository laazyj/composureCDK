import { describe, expect, it } from "vitest";
import { CfnParameter } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import {
  assertAssignable,
  buildFixture,
  newStack,
  tagsPerResource,
} from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { compose, ref } from "@composurecdk/core";
import { inferenceProfile } from "../src/inference-profile.js";
import {
  createModelAlarmBuilder,
  type ModelAlarmBuilderResult,
} from "../src/model-alarm-builder.js";
import type { ModelAlarmTarget } from "../src/model-alarms.js";

const MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const MODEL = new FoundationModelIdentifier(MODEL_ID);
const PROFILE = inferenceProfile.geographic({
  model: MODEL,
  geography: "eu",
  routingRegions: ["eu-west-1"],
});

const buildAndSynth = buildFixture(() => createModelAlarmBuilder().model(PROFILE), "Model");

function alarmFor(metricName: string, overrides: Record<string, unknown> = {}) {
  return {
    Namespace: "AWS/Bedrock",
    MetricName: metricName,
    Dimensions: [{ Name: "ModelId", Value: `eu.${MODEL_ID}` }],
    Period: 60,
    EvaluationPeriods: 5,
    DatapointsToAlarm: 3,
    ComparisonOperator: "GreaterThanThreshold",
    TreatMissingData: "notBreaching",
    ...overrides,
  };
}

describe("createModelAlarmBuilder", () => {
  it("creates the throttle, server-error and client-error alarms by default", () => {
    const { result, template } = buildAndSynth();

    expect(Object.keys(result.alarms)).toEqual([
      "invocationThrottles",
      "invocationServerErrors",
      "invocationClientErrors",
    ]);
    for (const metricName of [
      "InvocationThrottles",
      "InvocationServerErrors",
      "InvocationClientErrors",
    ]) {
      template.hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        alarmFor(metricName, { Statistic: "Sum", Threshold: 0 }),
      );
    }
  });

  it("dimensions a foundation model by its model id", () => {
    const { template } = buildAndSynth((b) => b.model(MODEL));

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: [{ Name: "ModelId", Value: MODEL_ID }],
    });
  });

  it("dimensions an application inference profile by its profile id", () => {
    const { template } = buildAndSynth((b) =>
      b.model({ kind: "application", profileArn: "arn", profileId: "k7vwfv6mgfmj", source: MODEL }),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: [{ Name: "ModelId", Value: "k7vwfv6mgfmj" }],
    });
  });

  it("enables the latency alarms with a threshold", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({
        invocationLatency: { threshold: 10_000 },
        timeToFirstToken: { threshold: 2_000, evaluationPeriods: 10 },
      }),
    );

    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      alarmFor("InvocationLatency", { ExtendedStatistic: "p90", Threshold: 10_000 }),
    );
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      alarmFor("TimeToFirstToken", {
        ExtendedStatistic: "p90",
        Threshold: 2_000,
        EvaluationPeriods: 10,
      }),
    );
  });

  it.each(["invocationLatency", "timeToFirstToken"] as const)(
    "requires a threshold to enable %s",
    (key) => {
      expect(() => buildAndSynth((b) => b.recommendedAlarms({ [key]: {} }))).toThrow(
        `The "${key}" alarm has no default threshold`,
      );
    },
  );

  it("sets the quota alarm at 80% of the supplied quota", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ estimatedTpmQuotaUsage: { quota: 400_000 } }),
    );

    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      alarmFor("EstimatedTPMQuotaUsage", { Statistic: "Maximum", Threshold: 320_000 }),
    );
  });

  it("honours a custom quota percentage", () => {
    const { template } = buildAndSynth((b) =>
      b.recommendedAlarms({ estimatedTpmQuotaUsage: { quota: 1_000, thresholdPercent: 0.5 } }),
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "EstimatedTPMQuotaUsage",
      Threshold: 500,
    });
  });

  it.each([
    [{ quota: 0 }, /quota must be a positive number/],
    [{ quota: 100, thresholdPercent: 0 }, /thresholdPercent must be in/],
    [{ quota: 100, thresholdPercent: 1.5 }, /thresholdPercent must be in/],
  ])("validates quota config %j", (estimatedTpmQuotaUsage, message) => {
    expect(() => buildAndSynth((b) => b.recommendedAlarms({ estimatedTpmQuotaUsage }))).toThrow(
      message,
    );
  });

  it("skips the quota alarm with a warning when the quota is a token", () => {
    const { result, template } = buildAndSynth((b, stack) =>
      b.recommendedAlarms({
        estimatedTpmQuotaUsage: {
          quota: new CfnParameter(stack, "Quota", { type: "Number" }).valueAsNumber,
        },
      }),
    );

    expect(result.alarms.estimatedTpmQuotaUsage).toBeUndefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("tunes and disables individual alarms", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms({
        invocationThrottles: { threshold: 5, datapointsToAlarm: 5 },
        invocationClientErrors: false,
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["invocationThrottles", "invocationServerErrors"]);
    template.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      alarmFor("InvocationThrottles", { Threshold: 5, DatapointsToAlarm: 5 }),
    );
  });

  it.each([false, { enabled: false }] as const)(
    "disables every recommended alarm with %j",
    (config) => {
      const { result, template } = buildAndSynth((b) => b.recommendedAlarms(config));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    },
  );

  it("adds a custom alarm against the model's metrics", () => {
    const { result, template } = buildAndSynth((b) =>
      b
        .recommendedAlarms(false)
        .addAlarm("outputTokens", (a) =>
          a.metric((m) => m.metric("OutputTokenCount", { statistic: "Sum" })).threshold(1_000_000),
        ),
    );

    expect(Object.keys(result.alarms)).toEqual(["outputTokens"]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "OutputTokenCount",
      Dimensions: [{ Name: "ModelId", Value: `eu.${MODEL_ID}` }],
      Threshold: 1_000_000,
    });
  });

  it("resolves the model from the build context", () => {
    const { template } = buildAndSynth(
      (b) => b.model(ref<{ model: ModelAlarmTarget }, ModelAlarmTarget>("config", (r) => r.model)),
      { context: { config: { model: MODEL } } },
    );

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Dimensions: [{ Name: "ModelId", Value: MODEL_ID }],
    });
  });

  it("requires a model", () => {
    const build = buildFixture(createModelAlarmBuilder, "Model");

    expect(() => build()).toThrow('ModelAlarmBuilder "Model" requires a model');
  });

  it("copies custom alarms independently", () => {
    const base = createModelAlarmBuilder()
      .model(MODEL)
      .recommendedAlarms(false)
      .addAlarm("a", (a) => a.metric((m) => m.metric("Invocations")));
    const copy = base.copy().addAlarm("b", (a) => a.metric((m) => m.metric("Invocations")));

    const build = (b: typeof base) => buildFixture(() => b, "Model")().result.alarms;
    expect(Object.keys(build(base))).toEqual(["a"]);
    expect(Object.keys(build(copy))).toEqual(["a", "b"]);
  });

  it("tags the alarms", () => {
    const { template } = buildAndSynth((b) => b.tag("Owner", "ml"));

    expect(tagsPerResource(template, "AWS::CloudWatch::Alarm")).toEqual(
      Array(3).fill([{ Key: "Owner", Value: "ml" }]),
    );
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: Match.stringLikeRegexp("throttling"),
    });
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        outputTokens: (a) =>
          a.metric((m) => m.metric("OutputTokenCount", { statistic: "Sum" })).threshold(1_000_000),
        inputTokens: (a) =>
          a.metric((m) => m.metric("InputTokenCount", { statistic: "Sum" })).threshold(1_000_000),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["outputTokens", "inputTokens"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: ModelAlarmBuilderResult = result;
    const throttles = typed.alarms.invocationThrottles;

    assertAssignable<Alarm | undefined, typeof throttles>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof throttles>();
    expect(throttles).toBeDefined();
    // @ts-expect-error -- "invocationThrottle" is not a model alarm key
    expect(typed.alarms.invocationThrottle).toBeUndefined();
  });

  it("resolves a declared custom key through a typed ref, and rejects an undeclared one", () => {
    const system = compose(
      {
        model: createModelAlarmBuilder()
          .model(PROFILE)
          .addAlarm("outputTokens", (a) =>
            a
              .metric((m) => m.metric("OutputTokenCount", { statistic: "Sum" }))
              .threshold(1_000_000),
          ),
        consumer: {
          build: (_scope: unknown, _id: string, context: Record<string, object>) => ({
            alarm: ref("model", (r: WithCustomAlarms<ModelAlarmBuilderResult, "outputTokens">) => {
              // @ts-expect-error -- "outputToken" was not declared as a custom key
              expect(r.alarms.outputToken).toBeUndefined();
              return r.alarms.outputTokens;
            }).resolve(context),
          }),
        },
      },
      { model: [], consumer: ["model"] },
    );

    const built = system.build(newStack(), "System");
    assertAssignable<Alarm, typeof built.consumer.alarm>();
    expect(built.consumer.alarm).toBe(built.model.alarms.outputTokens);
  });
});
