import { FoundationModelIdentifier, type IModel } from "aws-cdk-lib/aws-bedrock";
import { Construct, type IConstruct } from "constructs";
import { bedrockArn, environmentOf } from "./arn.js";
import {
  type ApplicationInferenceProfile,
  type InferenceProfile,
  assertLiteralId,
  idPrefix,
  INFERENCE_PROFILE_GEOGRAPHIES,
  inferenceProfile,
} from "./inference-profile.js";

/**
 * Anything a caller can invoke: an in-Region foundation model, a
 * system-defined or application inference profile, or any {@link IModel} (a
 * provisioned model, or `{ modelArn }` for a model ARN from elsewhere).
 */
export type InferenceTarget =
  FoundationModelIdentifier | InferenceProfile | ApplicationInferenceProfile | IModel;

/** @internal */
export function isInferenceProfile(target: InferenceTarget): target is InferenceProfile {
  return "kind" in target && (target.kind === "geographic" || target.kind === "global");
}

function isApplicationProfile(target: InferenceTarget): target is ApplicationInferenceProfile {
  return "kind" in target && target.kind === "application";
}

function isModel(target: InferenceTarget): target is IModel {
  return "modelArn" in target;
}

/** One IAM statement's resources and conditions for invoking a target. @internal */
export interface InvocationStatement {
  readonly resourceArns: string[];
  readonly conditions?: Record<string, Record<string, unknown>>;
}

/**
 * The statements for invoking `target` from the Region `scope` deploys to:
 * those the Bedrock user guide prescribes, and for an application profile the
 * shape verified against live IAM. A geographic profile without
 * `routingRegions` grants the model in every Region rather than an
 * enumerated list, still only through the profile (#628).
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html#geographic-cris-iam-setup
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html#global-cris-iam-setup
 * @internal
 */
export function invocationStatements(
  target: InferenceTarget,
  scope?: IConstruct,
): InvocationStatement[] {
  if (isModel(target)) return [{ resourceArns: [target.modelArn] }];
  if (isApplicationProfile(target)) {
    return [
      { resourceArns: [target.profileArn] },
      ...sourceStatements(target.source, scope, target.profileArn),
    ];
  }
  return sourceStatements(target, scope);
}

/**
 * Statements for a foundation model or system-defined profile. Through an
 * application profile (`viaProfile`), Bedrock checks only that profile's ARN
 * in `bedrock:InferenceProfileArn` and needs no access to the source profile
 * itself (verified live for a global source), so none is granted.
 */
function sourceStatements(
  target: FoundationModelIdentifier | InferenceProfile,
  scope: IConstruct | undefined,
  viaProfile?: string,
): InvocationStatement[] {
  const { partition, region: sourceRegion } = environmentOf(scope);
  const modelArn = (modelId: string, region: string) =>
    bedrockArn(partition, "foundation-model", modelId, region);
  const through = (arn: string) => ({ "bedrock:InferenceProfileArn": arn });

  if (!isInferenceProfile(target)) {
    return [
      {
        resourceArns: [modelArn(target.modelId, sourceRegion)],
        ...(viaProfile && { conditions: { StringEquals: through(viaProfile) } }),
      },
    ];
  }

  const profileArn = sourceArn(target, scope);
  const via = through(viaProfile ?? profileArn);
  const { modelId } = target.model;

  const ownProfile: InvocationStatement = {
    resourceArns: [profileArn],
    ...(target.kind === "global" && {
      conditions: { StringEquals: { "aws:RequestedRegion": sourceRegion } },
    }),
  };
  const models: InvocationStatement[] =
    target.kind === "geographic"
      ? [
          {
            resourceArns: (target.routingRegions
              ? [...new Set([sourceRegion, ...target.routingRegions])]
              : ["*"]
            ).map((region) => modelArn(modelId, region)),
            conditions: { StringEquals: via },
          },
        ]
      : [
          {
            resourceArns: [modelArn(modelId, sourceRegion)],
            conditions: { StringEquals: { "aws:RequestedRegion": sourceRegion, ...via } },
          },
          {
            resourceArns: [modelArn(modelId, "")],
            conditions: { StringEquals: { "aws:RequestedRegion": "unspecified", ...via } },
          },
        ];
  return viaProfile ? models : [ownProfile, ...models];
}

/**
 * The ARN that identifies `source` in `scope`'s Region: the foundation model
 * or the system-defined profile. @internal
 */
export function sourceArn(
  source: FoundationModelIdentifier | InferenceProfile,
  scope: IConstruct | undefined,
): string {
  const { partition, region, account } = environmentOf(scope);
  return isInferenceProfile(source)
    ? bedrockArn(partition, "inference-profile", source.profileId, region, account)
    : bedrockArn(partition, "foundation-model", source.modelId, region);
}

/**
 * Every resource ARN a caller in `scope`'s Region must be allowed to invoke to
 * use `target`. For a cross-Region profile that is the profile plus the
 * foundation model in the source Region and in each Region it routes to; for
 * an application profile, the profile plus its source's foundation models.
 *
 * {@link modelGrants.invoke} applies these with the conditions the Bedrock
 * user guide prescribes; use this list where you write a policy yourself,
 * such as a service control policy. A geographic profile without
 * `routingRegions` yields one Region-wildcard model ARN, so list the Regions
 * on the profile when the policy must name each one.
 *
 * @param scope - Resolves partition, Region and account from its stack. Omit
 *   for the `AWS::` pseudo-parameters.
 */
export function invocationArns(target: InferenceTarget, scope?: IConstruct): string[] {
  return invocationStatements(target, scope).flatMap((s) => s.resourceArns);
}

/** @internal */
export function scopeOf(principal: unknown): IConstruct | undefined {
  return Construct.isConstruct(principal) ? principal : undefined;
}

/** Options for {@link inferenceTarget.fromId}. */
export interface InferenceTargetIdOptions {
  /** For a geographic profile id: see {@link GeographicInferenceProfile.routingRegions}. */
  readonly routingRegions?: readonly string[];
}

const PROVISIONED_MODEL_ARN = ":provisioned-model/";

/**
 * Resolves an id that arrives as a string, such as from configuration, to the
 * target it names:
 *
 * - `anthropic.claude-…` → a `FoundationModelIdentifier`;
 * - `eu.anthropic.claude-…` or `global.anthropic.claude-…` → a system-defined
 *   profile, via {@link inferenceProfile.parse};
 * - a provisioned-model ARN → `{ modelArn }`.
 *
 * A two-segment id with an unknown first segment throws rather than being
 * taken for a model named after a geography. A system-defined or application
 * profile ARN throws too: the model it routes to cannot be read from it, and
 * a grant on the ARN alone would be incomplete. Pass the profile value instead.
 */
function fromId(id: string, options: InferenceTargetIdOptions = {}): InferenceTarget {
  assertLiteralId(id, "Inference target id");
  if (id.startsWith("arn:")) {
    if (id.includes(PROVISIONED_MODEL_ARN)) return { modelArn: id };
    throw new Error(
      `"${id}" is an ARN. inferenceTarget.fromId resolves foundation-model and system-defined ` +
        `profile ids, and provisioned-model ARNs. For an inference profile pass its id, or an ` +
        `ApplicationInferenceProfile value, so the model it routes to is granted as well.`,
    );
  }
  const parsed = idPrefix(id);
  if (!parsed) {
    throw new Error(`"${id}" is not a foundation model or inference profile id.`);
  }
  const { prefix, isProfile } = parsed;
  if (isProfile) return inferenceProfile.parse(id, options.routingRegions);
  if (id.includes(".", prefix.length + 1)) {
    throw new Error(
      `"${id}" looks like an inference profile id, but "${prefix}" is neither global nor one ` +
        `of INFERENCE_PROFILE_GEOGRAPHIES (${INFERENCE_PROFILE_GEOGRAPHIES.join(", ")}). ` +
        `For a new geography use inferenceProfile.geographic().`,
    );
  }
  if (options.routingRegions !== undefined) {
    throw new Error(
      `"${id}" is a foundation model id; routingRegions apply to a geographic profile.`,
    );
  }
  return new FoundationModelIdentifier(id);
}

/**
 * Factories for {@link InferenceTarget} values.
 *
 * @example
 * ```ts
 * const ids = ["anthropic.claude-sonnet-5-5", "us.anthropic.claude-haiku-4-5-20251001-v1:0"];
 * createFunctionBuilder().grant(...ids.map((id) => modelGrants.invoke(inferenceTarget.fromId(id))));
 * ```
 */
export const inferenceTarget = {
  /** Resolves a model id, system-defined profile id or provisioned-model ARN. */
  fromId,
};
