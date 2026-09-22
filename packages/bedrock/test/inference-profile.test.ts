import { describe, expect, it } from "vitest";
import { Aws } from "aws-cdk-lib";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import {
  foundationModelFor,
  INFERENCE_PROFILE_GEOGRAPHIES,
  inferenceProfile,
} from "../src/inference-profile.js";

const MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const MODEL = new FoundationModelIdentifier(MODEL_ID);
const EU_REGIONS = ["eu-central-1", "eu-west-1", "eu-west-3"];

describe("inferenceProfile.geographic", () => {
  it("derives the profile id from geography and model", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: EU_REGIONS,
    });

    expect(profile).toEqual({
      kind: "geographic",
      geography: "eu",
      model: MODEL,
      profileId: `eu.${MODEL_ID}`,
      routingRegions: EU_REGIONS,
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.routingRegions)).toBe(true);
  });

  it("de-duplicates routing regions", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-west-1", "eu-west-1", "eu-west-3"],
    });

    expect(profile.routingRegions).toEqual(["eu-west-1", "eu-west-3"]);
  });

  it("accepts a well-formed geography not yet listed", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "ca",
      routingRegions: ["ca-central-1"],
    });

    expect(profile.profileId).toBe(`ca.${MODEL_ID}`);
  });

  it.each(["global", "EU", "eu.", ""])("rejects geography %j", (geography) => {
    expect(() =>
      inferenceProfile.geographic({ model: MODEL, geography, routingRegions: EU_REGIONS }),
    ).toThrow(/not a geography prefix/);
  });

  it("rejects empty routing regions", () => {
    expect(() =>
      inferenceProfile.geographic({ model: MODEL, geography: "eu", routingRegions: [] }),
    ).toThrow(/routingRegions must not be empty/);
  });

  it.each(["eu-west1", "EU-WEST-1", "europe", Aws.REGION])(
    "rejects routing region %j",
    (region) => {
      expect(() =>
        inferenceProfile.geographic({ model: MODEL, geography: "eu", routingRegions: [region] }),
      ).toThrow(/not a literal AWS Region code/);
    },
  );

  it("accepts GovCloud region codes", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "us-gov",
      routingRegions: ["us-gov-west-1", "us-gov-east-1"],
    });

    expect(profile.profileId).toBe(`us-gov.${MODEL_ID}`);
  });

  it("rejects a profile id passed as the model", () => {
    expect(() =>
      inferenceProfile.geographic({
        model: new FoundationModelIdentifier(`eu.${MODEL_ID}`),
        geography: "eu",
        routingRegions: EU_REGIONS,
      }),
    ).toThrow(/is an inference profile id, not a foundation model id/);
  });

  it.each(["", Aws.REGION])("rejects model id %j", (modelId) => {
    expect(() =>
      inferenceProfile.geographic({
        model: new FoundationModelIdentifier(modelId),
        geography: "eu",
        routingRegions: EU_REGIONS,
      }),
    ).toThrow(/non-empty literal string/);
  });
});

describe("inferenceProfile.global", () => {
  it("derives the profile id from the model", () => {
    const profile = inferenceProfile.global(MODEL);

    expect(profile).toEqual({ kind: "global", model: MODEL, profileId: `global.${MODEL_ID}` });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("rejects a profile id passed as the model", () => {
    expect(() =>
      inferenceProfile.global(new FoundationModelIdentifier(`global.${MODEL_ID}`)),
    ).toThrow(/is an inference profile id/);
  });
});

describe("inferenceProfile.parse", () => {
  it.each(INFERENCE_PROFILE_GEOGRAPHIES)("round-trips a %s profile", (geography) => {
    const profile = inferenceProfile.parse(`${geography}.${MODEL_ID}`, ["us-east-1"]);

    expect(profile).toMatchObject({
      kind: "geographic",
      geography,
      profileId: `${geography}.${MODEL_ID}`,
    });
    expect(profile.model.modelId).toBe(MODEL_ID);
  });

  it("parses a global profile", () => {
    const profile = inferenceProfile.parse(`global.${MODEL_ID}`);

    expect(profile).toMatchObject({ kind: "global", profileId: `global.${MODEL_ID}` });
  });

  it("requires routing regions for a geographic profile", () => {
    // Exercises the untyped path an id read from configuration takes.
    const parse = inferenceProfile.parse as (id: string) => unknown;
    expect(() => parse(`eu.${MODEL_ID}`)).toThrow(/needs its routingRegions/);
  });

  it("rejects routing regions for a global profile", () => {
    expect(() => inferenceProfile.parse(`global.${MODEL_ID}`, EU_REGIONS)).toThrow(
      /omit routingRegions/,
    );
  });

  it.each([MODEL_ID, `ca.${MODEL_ID}`, "noprefix", `.${MODEL_ID}`])(
    "rejects %j as not a known profile id",
    (id) => {
      expect(() => inferenceProfile.parse(id, EU_REGIONS)).toThrow(
        /not a system-defined inference profile id/,
      );
    },
  );
});

describe("foundationModelFor", () => {
  it.each([`eu.${MODEL_ID}`, `us-gov.${MODEL_ID}`, `global.${MODEL_ID}`])(
    "strips the prefix of %s",
    (id) => {
      expect(foundationModelFor(id).modelId).toBe(MODEL_ID);
    },
  );

  it("does not mistake a provider for a geography", () => {
    expect(() => foundationModelFor(MODEL_ID)).toThrow(/not a system-defined inference profile id/);
  });
});
