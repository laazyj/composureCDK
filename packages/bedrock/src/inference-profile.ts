import { Token } from "aws-cdk-lib";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";

/**
 * Geography prefixes of Amazon Bedrock's system-defined cross-Region inference
 * profiles, e.g. the `eu` in `eu.anthropic.claude-haiku-4-5-20251001-v1:0`.
 *
 * {@link inferenceProfile.parse} recognises a profile id by one of these
 * prefixes. {@link inferenceProfile.geographic} also accepts a geography not
 * yet listed here.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html
 */
export const INFERENCE_PROFILE_GEOGRAPHIES = ["us", "eu", "apac", "jp", "au", "us-gov"] as const;

/** A known geography prefix. See {@link INFERENCE_PROFILE_GEOGRAPHIES}. */
export type InferenceProfileGeography = (typeof INFERENCE_PROFILE_GEOGRAPHIES)[number];

const GLOBAL_PREFIX = "global";

/**
 * A system-defined inference profile that routes requests to Regions within
 * one geography.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html
 */
export interface GeographicInferenceProfile {
  readonly kind: "geographic";
  readonly geography: InferenceProfileGeography | (string & {});
  /** The foundation model the profile serves. */
  readonly model: FoundationModelIdentifier;
  /** The id to invoke, e.g. `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. */
  readonly profileId: string;
  /**
   * Every Region the profile may route to from the source Region, as listed
   * by `aws bedrock get-inference-profile` or the model's page in the Bedrock
   * user guide. The source Region is always granted, listed or not.
   */
  readonly routingRegions: readonly string[];
}

/**
 * A system-defined inference profile that routes requests to any supported
 * commercial Region.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html
 */
export interface GlobalInferenceProfile {
  readonly kind: "global";
  /** The foundation model the profile serves. */
  readonly model: FoundationModelIdentifier;
  /** The id to invoke, e.g. `global.anthropic.claude-haiku-4-5-20251001-v1:0`. */
  readonly profileId: string;
}

/** A system-defined cross-Region inference profile. */
export type InferenceProfile = GeographicInferenceProfile | GlobalInferenceProfile;

/** Options for {@link inferenceProfile.geographic}. */
export type GeographicInferenceProfileOptions = Pick<
  GeographicInferenceProfile,
  "model" | "geography" | "routingRegions"
>;

const GEOGRAPHY_PATTERN = /^[a-z]+(-[a-z]+)*$/;
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;

function isProfilePrefix(prefix: string): boolean {
  return (
    prefix === GLOBAL_PREFIX ||
    (INFERENCE_PROFILE_GEOGRAPHIES as readonly string[]).includes(prefix)
  );
}

function prefixOf(id: string): string | undefined {
  const dot = id.indexOf(".");
  return dot > 0 ? id.slice(0, dot) : undefined;
}

function assertModel(model: FoundationModelIdentifier): void {
  const { modelId } = model;
  if (Token.isUnresolved(modelId) || modelId === "") {
    throw new Error("Inference profile model id must be a non-empty literal string.");
  }
  const prefix = prefixOf(modelId);
  if (prefix !== undefined && isProfilePrefix(prefix)) {
    throw new Error(
      `"${modelId}" is an inference profile id, not a foundation model id. ` +
        `Use inferenceProfile.parse("${modelId}", …) instead.`,
    );
  }
}

function assertRoutingRegions(profileId: string, regions: readonly string[]): void {
  if (regions.length === 0) {
    throw new Error(`Inference profile "${profileId}": routingRegions must not be empty.`);
  }
  for (const region of regions) {
    if (Token.isUnresolved(region) || !REGION_PATTERN.test(region)) {
      throw new Error(
        `Inference profile "${profileId}": "${region}" is not a literal AWS Region code.`,
      );
    }
  }
}

function geographic(options: GeographicInferenceProfileOptions): GeographicInferenceProfile {
  const { model, geography } = options;
  assertModel(model);
  if (geography === GLOBAL_PREFIX || !GEOGRAPHY_PATTERN.test(geography)) {
    throw new Error(
      `"${geography}" is not a geography prefix. Use inferenceProfile.global() for a global profile.`,
    );
  }
  const profileId = `${geography}.${model.modelId}`;
  assertRoutingRegions(profileId, options.routingRegions);
  return Object.freeze({
    kind: "geographic",
    geography,
    model,
    profileId,
    routingRegions: Object.freeze([...new Set(options.routingRegions)]),
  });
}

function global(model: FoundationModelIdentifier): GlobalInferenceProfile {
  assertModel(model);
  return Object.freeze({ kind: "global", model, profileId: `${GLOBAL_PREFIX}.${model.modelId}` });
}

function splitProfileId(profileId: string): { prefix: string; modelId: string } {
  const prefix = prefixOf(profileId);
  if (prefix === undefined || !isProfilePrefix(prefix)) {
    throw new Error(
      `"${profileId}" is not a system-defined inference profile id. Expected one of the ` +
        `prefixes: ${[GLOBAL_PREFIX, ...INFERENCE_PROFILE_GEOGRAPHIES].join(", ")}.`,
    );
  }
  return { prefix, modelId: profileId.slice(prefix.length + 1) };
}

function parse(profileId: string): GlobalInferenceProfile;
function parse(profileId: string, routingRegions: readonly string[]): InferenceProfile;
function parse(profileId: string, routingRegions?: readonly string[]): InferenceProfile {
  const { prefix, modelId } = splitProfileId(profileId);
  const model = new FoundationModelIdentifier(modelId);
  if (prefix === GLOBAL_PREFIX) {
    if (routingRegions !== undefined) {
      throw new Error(
        `Inference profile "${profileId}" is global and routes to every supported Region; omit routingRegions.`,
      );
    }
    return global(model);
  }
  if (routingRegions === undefined) {
    throw new Error(`Inference profile "${profileId}" is geographic and needs its routingRegions.`);
  }
  return geographic({ model, geography: prefix, routingRegions });
}

/**
 * Factories for {@link InferenceProfile} values.
 *
 * @example
 * ```ts
 * const haiku = inferenceProfile.geographic({
 *   model: FoundationModelIdentifier.ANTHROPIC_CLAUDE_HAIKU_4_5_20251001_V1_0,
 *   geography: "eu",
 *   routingRegions: ["eu-central-1", "eu-north-1", "eu-south-1", "eu-south-2", "eu-west-1", "eu-west-3"],
 * });
 * haiku.profileId; // "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
 * ```
 */
export const inferenceProfile = {
  /** A profile routing within one geography. */
  geographic,
  /** A profile routing to any supported commercial Region. */
  global,
  /**
   * Reads a profile id such as `eu.anthropic.claude-haiku-4-5-20251001-v1:0`.
   * Throws unless the id starts with a known geography or `global`. A
   * geographic id needs its `routingRegions`; a global id takes none.
   */
  parse,
};

/**
 * The foundation model a system-defined inference profile serves:
 * `eu.anthropic.x` → `anthropic.x`. Throws unless the id starts with a known
 * geography or `global`.
 */
export function foundationModelFor(profileId: string): FoundationModelIdentifier {
  return new FoundationModelIdentifier(splitProfileId(profileId).modelId);
}
