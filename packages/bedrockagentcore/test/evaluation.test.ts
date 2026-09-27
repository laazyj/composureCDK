import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import {
  BuiltinEvaluator,
  DataSourceConfig,
  EvaluationLevel,
  EvaluatorConfig,
  EvaluatorRatingScale,
  EvaluatorSelector,
} from "aws-cdk-lib/aws-bedrockagentcore";
import { type IRole, Role } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { buildFixture, newStack, policyJson } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { inferenceProfile, modelGrants } from "@composurecdk/bedrock";
import { createEvaluatorBuilder } from "../src/evaluator-builder.js";
import { createOnlineEvaluationBuilder } from "../src/online-evaluation-builder.js";

const haiku = inferenceProfile.global(
  FoundationModelIdentifier.ANTHROPIC_CLAUDE_HAIKU_4_5_20251001_V1_0,
);

const judge = {
  instructions: "Rate the tone of {assistant_turn}.",
  ratingScale: EvaluatorRatingScale.categorical([
    { label: "Good", definition: "Polite and clear." },
    { label: "Poor", definition: "Rude or unclear." },
  ]),
};

const tone = () => createEvaluatorBuilder().evaluatorName("tone").level(EvaluationLevel.TRACE);

describe("createEvaluatorBuilder", () => {
  const buildAndSynth = buildFixture(tone, "Tone");

  it("builds an LLM-as-a-judge evaluator from a bedrock target", () => {
    const { template, result } = buildAndSynth((b) => b.llmAsAJudge({ ...judge, model: haiku }));

    expect(JSON.stringify(template.findResources("AWS::BedrockAgentCore::Evaluator"))).toContain(
      haiku.profileId,
    );
    expect(result.judge).toBe(haiku);
    expect(result.selector.evaluatorId).toBeDefined();
  });

  it("accepts a foundation model as the judge", () => {
    const model = FoundationModelIdentifier.ANTHROPIC_CLAUDE_HAIKU_4_5_20251001_V1_0;
    const { template } = buildAndSynth((b) => b.llmAsAJudge({ ...judge, model }));

    expect(JSON.stringify(template.toJSON())).toContain(`"${model.modelId}"`);
  });

  it("builds a code-based evaluator with the function from the build context", () => {
    const stack = newStack();
    const fn = new LambdaFunction(stack, "Check", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => ({});"),
    });
    const { judge: none } = tone()
      .codeBased({ lambdaFunction: ref<{ fn: LambdaFunction }>("check").get("fn") })
      .build(stack, "Tone", { check: { fn } });

    expect(none).toBeUndefined();
    Template.fromStack(stack).resourceCountIs("AWS::Lambda::Permission", 1);
  });

  it("passes an EvaluatorConfig through", () => {
    const { template } = buildAndSynth((b) =>
      b.evaluatorConfig(EvaluatorConfig.llmAsAJudge({ ...judge, modelId: haiku.profileId })),
    );

    template.resourceCountIs("AWS::BedrockAgentCore::Evaluator", 1);
  });

  it.each([
    ["no config", tone],
    [
      "two configs",
      () =>
        tone()
          .llmAsAJudge({ ...judge, model: haiku })
          .evaluatorConfig(EvaluatorConfig.llmAsAJudge({ ...judge, modelId: haiku.profileId })),
    ],
    ["no name", () => createEvaluatorBuilder().level(EvaluationLevel.TRACE)],
  ])("rejects %s", (_, factory) => {
    expect(() => buildFixture(factory, "Tone")()).toThrow(
      /requires an evaluatorName, a level and exactly one of/,
    );
  });
});

describe("createOnlineEvaluationBuilder", () => {
  const evaluation = () =>
    createOnlineEvaluationBuilder()
      .onlineEvaluationConfigName("quality")
      .evaluators([EvaluatorSelector.builtin(BuiltinEvaluator.HELPFULNESS)])
      .dataSource(
        DataSourceConfig.fromCloudWatchLogs({
          logGroupNames: ["/aws/agent/traces"],
          serviceNames: ["support"],
        }),
      );
  const buildAndSynth = buildFixture(evaluation, "Quality");

  it("is enabled, at the service's 10% sampling", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::BedrockAgentCore::OnlineEvaluationConfig", {
      ExecutionStatus: "ENABLED",
      Rule: { SamplingConfig: { SamplingPercentage: 10 } },
    });
  });

  describe("alarms", () => {
    it("creates no alarms by default", () => {
      const { result, template } = buildAndSynth();

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("alarms when an evaluator's average score falls below the threshold", () => {
      const { result, template } = buildAndSynth((b) =>
        b.recommendedAlarms({ scores: { "Builtin.Helpfulness": { threshold: 0.5 } } }),
      );

      expect(Object.keys(result.alarms)).toEqual(["Builtin.Helpfulness"]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "Bedrock-AgentCore/Evaluations",
        MetricName: "Builtin.Helpfulness",
        Statistic: "Average",
        Period: 3600,
        ComparisonOperator: "LessThanThreshold",
        Threshold: 0.5,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 2,
        TreatMissingData: "notBreaching",
        Dimensions: [
          Match.objectLike({ Name: "onlineEvaluationConfigId" }),
          { Name: "service.name", Value: "support" },
        ],
      });
    });

    it("rejects a score alarm for an evaluator it does not run", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.recommendedAlarms({ scores: { "Builtin.Correctness": { threshold: 0.5 } } }),
        ),
      ).toThrow(/"Builtin.Correctness" names none of the evaluation's evaluators/);
    });

    it("cannot check keys when an evaluator is only known at deploy time", () => {
      const stack = newStack();
      const evaluator = tone()
        .llmAsAJudge({ ...judge, model: haiku })
        .build(stack, "Tone");
      const { alarms } = createOnlineEvaluationBuilder()
        .onlineEvaluationConfigName("quality")
        .evaluators([evaluator.selector])
        .dataSource(
          DataSourceConfig.fromCloudWatchLogs({
            logGroupNames: ["/aws/agent/traces"],
            serviceNames: ["support"],
          }),
        )
        .recommendedAlarms({ scores: { tone: { threshold: 2 } } })
        .build(stack, "Quality");

      expect(Object.keys(alarms)).toEqual(["tone"]);
    });

    it("adds custom alarms on score metrics", () => {
      const base = evaluation();
      const copy = base.copy().addAlarm("samples", (a) =>
        a
          .metric((m) => m.metric("Builtin.Helpfulness", { statistic: "SampleCount" }))
          .threshold(1)
          .lessThan(),
      );

      expect(Object.keys(base.build(newStack(), "Quality").alarms)).toEqual([]);
      expect(Object.keys(copy.build(newStack(), "Quality").alarms)).toEqual(["samples"]);
    });
  });

  it("gives its execution role no model access", () => {
    const { stack } = buildAndSynth();

    const policy = policyJson(stack);
    expect(policy).not.toContain("bedrock:InvokeModel");
    expect(policy).toContain("logs:StartQuery");
    expect(policy).toContain("/aws/agent/traces");
    expect(policy).toContain("aws/spans");
  });

  it("trusts the service only for this account's evaluations", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: Match.objectLike({
              StringEquals: Match.objectLike({ "aws:ResourceAccount": Match.anyValue() }),
            }),
          }),
        ],
      },
    });
  });

  it("grants a judge model explicitly", () => {
    const { stack } = buildAndSynth((b) => b.grant(modelGrants.invoke(haiku)));

    expect(policyJson(stack)).toContain("bedrock:InvokeModel");
  });

  it("resolves evaluators, the data source and a supplied role from the build context", () => {
    const stack = newStack();
    const role = Role.fromRoleName(stack, "Imported", "evaluation-role");
    const evaluator = tone()
      .llmAsAJudge({ ...judge, model: haiku })
      .build(stack, "Tone");
    const { onlineEvaluation } = createOnlineEvaluationBuilder()
      .onlineEvaluationConfigName("quality")
      .evaluators([ref<typeof evaluator>("tone").get("selector")])
      .dataSource(ref<{ source: DataSourceConfig }>("logs").get("source"))
      .executionRole(ref<{ role: IRole }>("iam").get("role"))
      .build(stack, "Quality", {
        tone: evaluator,
        logs: {
          source: DataSourceConfig.fromCloudWatchLogs({
            logGroupNames: ["/aws/agent/traces"],
            serviceNames: ["support"],
          }),
        },
        iam: { role },
      });

    expect(onlineEvaluation.executionRole).toBe(role);
  });

  it("requires a name, evaluators and a data source", () => {
    expect(() => buildFixture(createOnlineEvaluationBuilder, "Quality")()).toThrow(
      /requires an onlineEvaluationConfigName, evaluators and a dataSource/,
    );
  });

  it("copies grants independently", () => {
    const base = evaluation();
    const copy = base.copy().grant(modelGrants.invoke(haiku));

    const policy = (b: typeof base) => {
      const stack = newStack();
      b.build(stack, "Quality");
      return policyJson(stack);
    };
    expect(policy(base)).not.toContain("bedrock:InvokeModel");
    expect(policy(copy)).toContain("bedrock:InvokeModel");
  });

  it("tags the online evaluation", () => {
    const { template } = buildAndSynth((b) => b.tag("Project", "support"));

    template.hasResourceProperties("AWS::BedrockAgentCore::OnlineEvaluationConfig", {
      Tags: Match.arrayWith([{ Key: "Project", Value: "support" }]),
    });
  });
});
