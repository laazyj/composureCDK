import { describe, expect, it } from "vitest";
import { Aws } from "aws-cdk-lib";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { inferenceTarget } from "../src/inference-target.js";

const MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const { fromId } = inferenceTarget;

describe("inferenceTarget.fromId", () => {
  it("resolves a foundation model id", () => {
    const target = fromId(MODEL_ID);

    expect(target).toBeInstanceOf(FoundationModelIdentifier);
    expect((target as FoundationModelIdentifier).modelId).toBe(MODEL_ID);
  });

  it.each(["us", "eu", "apac", "jp", "au", "in", "us-gov"])(
    "resolves a %s geographic profile id without routing regions",
    (geography) => {
      expect(fromId(`${geography}.${MODEL_ID}`)).toMatchObject({
        kind: "geographic",
        geography,
        profileId: `${geography}.${MODEL_ID}`,
      });
    },
  );

  it("passes routing regions to a geographic profile", () => {
    expect(fromId(`eu.${MODEL_ID}`, { routingRegions: ["eu-west-3"] })).toMatchObject({
      routingRegions: ["eu-west-3"],
    });
  });

  it("resolves a global profile id", () => {
    expect(fromId(`global.${MODEL_ID}`)).toMatchObject({ kind: "global" });
  });

  it("resolves a provisioned-model ARN", () => {
    const arn = "arn:aws:bedrock:eu-west-1:123456789012:provisioned-model/abc";

    expect(fromId(arn)).toEqual({ modelArn: arn });
  });

  it.each([
    "arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.x",
    "arn:aws:bedrock:eu-west-1:123456789012:application-inference-profile/app1",
    "arn:aws:bedrock:eu-west-1::foundation-model/anthropic.x",
  ])("rejects %s, whose source model it cannot recover", (arn) => {
    expect(() => fromId(arn)).toThrow(/is an ARN/);
  });

  it("rejects a profile id with an unknown prefix rather than taking it for a model", () => {
    expect(() => fromId(`ca.${MODEL_ID}`)).toThrow(
      /"ca" is neither global nor one of INFERENCE_PROFILE_GEOGRAPHIES/,
    );
  });

  it("rejects routing regions for a foundation model", () => {
    expect(() => fromId(MODEL_ID, { routingRegions: ["eu-west-3"] })).toThrow(
      /routingRegions apply to a geographic profile/,
    );
  });

  it.each(["", "noprefix", `.${MODEL_ID}`, Aws.REGION])("rejects %j", (id) => {
    expect(() => fromId(id)).toThrow();
  });
});
