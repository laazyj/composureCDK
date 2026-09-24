import { Arn, ArnFormat, Aws, Stack } from "aws-cdk-lib";
import type { FoundationModelIdentifier, IModel } from "aws-cdk-lib/aws-bedrock";
import { Construct, type IConstruct } from "constructs";
import type { ApplicationInferenceProfile, InferenceProfile } from "./inference-profile.js";

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

type Environment = Pick<Stack, "partition" | "region" | "account">;

function environmentOf(scope: IConstruct | undefined): Environment {
  return scope === undefined
    ? { partition: Aws.PARTITION, region: Aws.REGION, account: Aws.ACCOUNT_ID }
    : Stack.of(scope);
}

function bedrockArn(
  partition: string,
  resource: string,
  resourceName: string,
  region: string,
  account = "",
): string {
  return Arn.format({
    partition,
    service: "bedrock",
    region,
    account,
    resource,
    resourceName,
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });
}

/**
 * The statements for invoking `target` from the Region `scope` deploys to:
 * those the Bedrock user guide prescribes, and for an application profile the
 * shape verified against live IAM.
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
            resourceArns: [...new Set([sourceRegion, ...target.routingRegions])].map((region) =>
              modelArn(modelId, region),
            ),
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
 * such as a service control policy.
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
