import { describe, expect, it } from "vitest";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { buildFixture, TEST_ACCOUNT, tagsPerResource, testEnv } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import { createApplicationInferenceProfileBuilder } from "../src/application-inference-profile-builder.js";
import { type InferenceProfile, inferenceProfile } from "../src/inference-profile.js";

const MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const MODEL = new FoundationModelIdentifier(MODEL_ID);
const REGION = "eu-west-2";

const buildAndSynth = buildFixture(
  () => createApplicationInferenceProfileBuilder().inferenceProfileName("support"),
  "Profile",
  { stackProps: { env: testEnv(REGION) } },
);

/** The `copyFrom` ARN with the partition token as `aws`. */
function copyFromOf(template: ReturnType<typeof buildAndSynth>["template"]): string {
  const [resource] = Object.values(
    template.findResources("AWS::Bedrock::ApplicationInferenceProfile"),
  ) as { Properties: { ModelSource: { CopyFrom: { "Fn::Join": [string, unknown[]] } } } }[];
  const [sep, parts] = resource.Properties.ModelSource.CopyFrom["Fn::Join"];
  return parts.map((p) => (typeof p === "string" ? p : "aws")).join(sep);
}

describe("createApplicationInferenceProfileBuilder", () => {
  it("copies from a foundation model in the stack's Region", () => {
    const { template } = buildAndSynth((b) => b.source(MODEL).description("Support assistant"));

    expect(copyFromOf(template)).toBe(`arn:aws:bedrock:${REGION}::foundation-model/${MODEL_ID}`);
    template.hasResourceProperties("AWS::Bedrock::ApplicationInferenceProfile", {
      InferenceProfileName: "support",
      Description: "Support assistant",
    });
  });

  it("copies from a system-defined profile", () => {
    const { template } = buildAndSynth((b) => b.source(inferenceProfile.global(MODEL)));

    expect(copyFromOf(template)).toBe(
      `arn:aws:bedrock:${REGION}:${TEST_ACCOUNT}:inference-profile/global.${MODEL_ID}`,
    );
  });

  it("exposes the profile as an invocation target", () => {
    const { result } = buildAndSynth((b) => b.source(MODEL));

    expect(result.profile).toEqual({
      kind: "application",
      profileArn: result.applicationInferenceProfile.attrInferenceProfileArn,
      profileId: result.applicationInferenceProfile.attrInferenceProfileId,
      source: MODEL,
    });
  });

  it("resolves the source from the build context", () => {
    const profile = inferenceProfile.global(MODEL);
    const { result } = buildAndSynth(
      (b) => b.source(ref<{ model: InferenceProfile }, InferenceProfile>("config", (r) => r.model)),
      { context: { config: { model: profile } } },
    );

    expect(result.profile.source).toBe(profile);
  });

  it("requires a name and a source", () => {
    const build = buildFixture(createApplicationInferenceProfileBuilder, "Profile");
    const message = 'ApplicationInferenceProfileBuilder "Profile" requires an inferenceProfileName';

    expect(() => build((b) => b.source(MODEL))).toThrow(message);
    expect(() => build((b) => b.inferenceProfileName("support"))).toThrow(message);
  });

  it("tags the profile for cost allocation", () => {
    const { template } = buildAndSynth((b) => b.source(MODEL).tag("CostCentre", "support"));

    expect(tagsPerResource(template, "AWS::Bedrock::ApplicationInferenceProfile")).toEqual([
      [{ Key: "CostCentre", Value: "support" }],
    ]);
  });
});
