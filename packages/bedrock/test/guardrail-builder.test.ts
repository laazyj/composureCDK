import { describe, expect, it } from "vitest";
import { App, CfnParameter, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { buildFixture, tagsPerResource } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createGuardrailBuilder } from "../src/guardrail-builder.js";

const buildAndSynth = buildFixture(() => createGuardrailBuilder().name("support"), "Guardrail");

function versionLogicalIds(template: Template): string[] {
  return Object.keys(template.findResources("AWS::Bedrock::GuardrailVersion"));
}

describe("createGuardrailBuilder", () => {
  it("filters harmful content and prompt attacks at HIGH by default", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::Bedrock::Guardrail", {
      Name: "support",
      BlockedInputMessaging: "Sorry, the model cannot answer this question.",
      BlockedOutputsMessaging: "Sorry, the model cannot answer this question.",
      ContentPolicyConfig: {
        FiltersConfig: [
          { Type: "SEXUAL", InputStrength: "HIGH", OutputStrength: "HIGH" },
          { Type: "VIOLENCE", InputStrength: "HIGH", OutputStrength: "HIGH" },
          { Type: "HATE", InputStrength: "HIGH", OutputStrength: "HIGH" },
          { Type: "INSULTS", InputStrength: "HIGH", OutputStrength: "HIGH" },
          { Type: "MISCONDUCT", InputStrength: "HIGH", OutputStrength: "HIGH" },
          { Type: "PROMPT_ATTACK", InputStrength: "HIGH", OutputStrength: "NONE" },
        ],
      },
    });
  });

  it("overrides defaults and passes other props through", () => {
    const { template } = buildAndSynth((b) =>
      b.blockedInputMessaging("Blocked.").topicPolicyConfig({
        topicsConfig: [{ name: "Legal", definition: "Legal advice.", type: "DENY" }],
      }),
    );

    template.hasResourceProperties("AWS::Bedrock::Guardrail", {
      BlockedInputMessaging: "Blocked.",
      TopicPolicyConfig: { TopicsConfig: [Match.objectLike({ Name: "Legal" })] },
    });
  });

  it("requires a name", () => {
    const build = buildFixture(createGuardrailBuilder, "Guardrail");

    expect(() => build()).toThrow('GuardrailBuilder "Guardrail" requires a name');
  });

  it("resolves a KMS key ARN from the build context", () => {
    const arn = "arn:aws:kms:eu-west-2:123456789012:key/abc";
    const { template } = buildAndSynth(
      (b) => b.kmsKeyArn(ref<{ keyArn: string }, string>("key", (r) => r.keyArn)),
      { context: { key: { keyArn: arn } } },
    );

    template.hasResourceProperties("AWS::Bedrock::Guardrail", { KmsKeyArn: arn });
  });

  it("publishes a version and exposes its reference", () => {
    const { result, template } = buildAndSynth();

    template.hasResourceProperties("AWS::Bedrock::GuardrailVersion", {
      GuardrailIdentifier: { "Fn::GetAtt": [Match.stringLikeRegexp("^Guardrail"), "GuardrailId"] },
    });
    const stack = new Stack();
    expect(stack.resolve(result.reference)).toEqual({
      guardrailArn: { "Fn::GetAtt": [expect.stringMatching(/^Guardrail/), "GuardrailArn"] },
      version: { "Fn::GetAtt": [expect.stringMatching(/^GuardrailVersion/), "Version"] },
    });
  });

  it("publishes a new version when the configuration changes, and only then", () => {
    const first = versionLogicalIds(buildAndSynth().template);
    const same = versionLogicalIds(buildAndSynth().template);
    const changed = versionLogicalIds(
      buildAndSynth((b) => b.blockedOutputsMessaging("Changed.")).template,
    );

    expect(same).toEqual(first);
    expect(changed).not.toEqual(first);
  });

  it("keeps the version stable across synths when the configuration has tokens", () => {
    const withToken = () =>
      versionLogicalIds(
        buildAndSynth((b, stack) => b.kmsKeyArn(new CfnParameter(stack, "KeyArn").valueAsString))
          .template,
      );

    expect(withToken()).toEqual(withToken());
  });

  describe("alarms", () => {
    it("creates none by default", () => {
      const { result } = buildAndSynth();

      expect(result.alarms).toEqual({});
    });

    it("creates the opt-in alarms with thresholds on the guardrail version", () => {
      const { result, template } = buildAndSynth((b) =>
        b.recommendedAlarms({
          invocationsIntervened: { threshold: 20 },
          invocationLatency: { threshold: 500, evaluationPeriods: 10 },
        }),
      );

      expect(Object.keys(result.alarms)).toEqual(["invocationsIntervened", "invocationLatency"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Bedrock/Guardrails",
        MetricName: "InvocationsIntervened",
        Statistic: "Sum",
        Threshold: 20,
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
        Dimensions: Match.arrayWith([
          Match.objectLike({ Name: "GuardrailArn" }),
          Match.objectLike({ Name: "GuardrailVersion" }),
        ]),
      });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "InvocationLatency",
        ExtendedStatistic: "p90",
        EvaluationPeriods: 10,
      });
    });

    it.each(["invocationsIntervened", "invocationLatency"] as const)(
      "requires a threshold for %s",
      (key) => {
        expect(() => buildAndSynth((b) => b.recommendedAlarms({ [key]: {} }))).toThrow(
          `The "${key}" alarm has no default threshold`,
        );
      },
    );

    it.each([false, { enabled: false, invocationsIntervened: { threshold: 1 } }] as const)(
      "disables every alarm with %j",
      (config) => {
        expect(buildAndSynth((b) => b.recommendedAlarms(config)).result.alarms).toEqual({});
      },
    );

    it("adds a custom alarm on the guardrail's metrics", () => {
      const { result, template } = buildAndSynth((b) =>
        b.addAlarm("textUnits", (a) =>
          a.metric((m) => m.metric("TextUnitCount", { statistic: "Sum" })).threshold(1_000),
        ),
      );

      expect(Object.keys(result.alarms)).toEqual(["textUnits"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "AWS/Bedrock/Guardrails",
        MetricName: "TextUnitCount",
      });
    });

    it("copies custom alarms independently", () => {
      const base = createGuardrailBuilder()
        .name("support")
        .addAlarm("a", (a) => a.metric((m) => m.metric("Invocations")));
      const copy = base.copy().addAlarm("b", (a) => a.metric((m) => m.metric("Invocations")));

      const build = (b: typeof base) => b.build(new Stack(new App(), "S"), "Guardrail").alarms;
      expect(Object.keys(build(base))).toEqual(["a"]);
      expect(Object.keys(build(copy))).toEqual(["a", "b"]);
    });
  });

  it("tags the guardrail", () => {
    const { template } = buildAndSynth((b) => b.tag("Owner", "ml"));

    expect(tagsPerResource(template, "AWS::Bedrock::Guardrail")).toEqual([
      [{ Key: "Owner", Value: "ml" }],
    ]);
  });
});
