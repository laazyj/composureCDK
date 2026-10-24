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
export const INFERENCE_PROFILE_GEOGRAPHIES = [
  "us",
  "eu",
  "apac",
  "jp",
  "au",
  "in",
  "us-gov",
] as const;

/** A known geography prefix. See {@link INFERENCE_PROFILE_GEOGRAPHIES}. */
export type InferenceProfileGeography = (typeof INFERENCE_PROFILE_GEOGRAPHIES)[number];

const GLOBAL_PREFIX = "global";

const PROFILE_PREFIXES: readonly string[] = [GLOBAL_PREFIX, ...INFERENCE_PROFILE_GEOGRAPHIES];

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
   * The Regions the profile routes to from the source Region, as listed by
   * `aws bedrock get-inference-profile`. AWS chooses and extends that list,
   * so a copy of it is a snapshot. Bedrock checks the model in every Region
   * the profile may route to, so once AWS adds one, a grant built from the
   * copy denies every call through the profile.
   *
   * Omitted, the grant covers the foundation model in every Region, still
   * only through this profile. List the Regions when the policy must name
   * each one, for a service control policy or a policy scanner. The source
   * Region is always granted.
   */
  readonly routingRegions?: readonly string[];
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

/**
 * An application inference profile: an account-owned profile, tagged for
 * cost allocation, that routes to a foundation model or a system-defined
 * profile. Build one with `createApplicationInferenceProfileBuilder()`.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html
 */
export interface ApplicationInferenceProfile {
  readonly kind: "application";
  /** The profile's ARN, which callers pass as the model id. */
  readonly profileArn: string;
  /**
   * The profile's id, the last segment of {@link profileArn}: the `ModelId`
   * its invocation metrics are reported under.
   */
  readonly profileId: string;
  /** What the profile routes to. */
  readonly source: FoundationModelIdentifier | InferenceProfile;
}

/** Options for {@link inferenceProfile.geographic}. */
export type GeographicInferenceProfileOptions = Pick<
  GeographicInferenceProfile,
  "model" | "geography" | "routingRegions"
>;

const GEOGRAPHY_PATTERN = /^[a-z]+(-[a-z]+)*$/;
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;

/**
 * The segment of `id` before its first dot, and whether it marks a
 * system-defined profile id. Undefined when `id` has no such segment.
 * @internal
 */
export function idPrefix(id: string): { prefix: string; isProfile: boolean } | undefined {
  const dot = id.indexOf(".");
  if (dot <= 0) return undefined;
  const prefix = id.slice(0, dot);
  return { prefix, isProfile: PROFILE_PREFIXES.includes(prefix) };
}

/** Throws unless `id` is a non-empty literal string. @internal */
export function assertLiteralId(id: string, label: string): void {
  if (Token.isUnresolved(id) || id === "") {
    throw new Error(`${label} must be a non-empty literal string.`);
  }
}

function assertModel(model: FoundationModelIdentifier): void {
  const { modelId } = model;
  assertLiteralId(modelId, "Inference profile model id");
  if (idPrefix(modelId)?.isProfile) {
    throw new Error(
      `"${modelId}" is an inference profile id, not a foundation model id. ` +
        `Use inferenceProfile.parse("${modelId}") instead.`,
    );
  }
}

function assertRoutingRegions(profileId: string, regions: readonly string[]): void {
  if (regions.length === 0) {
    throw new Error(
      `Inference profile "${profileId}": routingRegions must not be empty; omit it to grant every Region.`,
    );
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
  const { model, geography, routingRegions } = options;
  assertModel(model);
  if (geography === GLOBAL_PREFIX || !GEOGRAPHY_PATTERN.test(geography)) {
    throw new Error(
      `"${geography}" is not a geography prefix. Use inferenceProfile.global() for a global profile.`,
    );
  }
  const profileId = `${geography}.${model.modelId}`;
  if (routingRegions !== undefined) assertRoutingRegions(profileId, routingRegions);
  return Object.freeze({
    kind: "geographic",
    geography,
    model,
    profileId,
    ...(routingRegions && { routingRegions: Object.freeze([...new Set(routingRegions)]) }),
  });
}

function global(model: FoundationModelIdentifier): GlobalInferenceProfile {
  assertModel(model);
  return Object.freeze({ kind: "global", model, profileId: `${GLOBAL_PREFIX}.${model.modelId}` });
}

function splitProfileId(profileId: string): { prefix: string; modelId: string } {
  const parsed = idPrefix(profileId);
  if (!parsed?.isProfile) {
    throw new Error(
      `"${profileId}" is not a system-defined inference profile id. Expected one of the ` +
        `prefixes: ${PROFILE_PREFIXES.join(", ")}.`,
    );
  }
  const { prefix } = parsed;
  return { prefix, modelId: profileId.slice(prefix.length + 1) };
}

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
   * geographic id may take its `routingRegions`; a global id takes none.
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
