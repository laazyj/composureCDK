import { Arn, ArnFormat, Aws, Stack } from "aws-cdk-lib";
import type { FoundationModelIdentifier, IModel } from "aws-cdk-lib/aws-bedrock";
import { Construct, type IConstruct } from "constructs";
import type { InferenceProfile } from "./inference-profile.js";

/**
 * Anything a caller can invoke: an in-Region foundation model, a
 * system-defined inference profile, or any {@link IModel} (a provisioned
 * model, or `{ modelArn }` for a model ARN from elsewhere).
 */
export type InferenceTarget = FoundationModelIdentifier | InferenceProfile | IModel;

/** @internal */
export function isInferenceProfile(target: InferenceTarget): target is InferenceProfile {
  return "kind" in target;
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
 * The statements the Bedrock user guide prescribes for invoking `target` from
 * the Region `scope` deploys to.
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

  const { partition, region: sourceRegion, account } = environmentOf(scope);
  const modelArn = (modelId: string, region: string) =>
    bedrockArn(partition, "foundation-model", modelId, region);

  if (!isInferenceProfile(target)) {
    return [{ resourceArns: [modelArn(target.modelId, sourceRegion)] }];
  }

  const profileArn = bedrockArn(
    partition,
    "inference-profile",
    target.profileId,
    sourceRegion,
    account,
  );
  const { modelId } = target.model;

  if (target.kind === "geographic") {
    const regions = [...new Set([sourceRegion, ...target.routingRegions])];
    return [
      { resourceArns: [profileArn] },
      {
        resourceArns: regions.map((region) => modelArn(modelId, region)),
        conditions: { StringEquals: { "bedrock:InferenceProfileArn": profileArn } },
      },
    ];
  }

  return [
    {
      resourceArns: [profileArn],
      conditions: { StringEquals: { "aws:RequestedRegion": sourceRegion } },
    },
    {
      resourceArns: [modelArn(modelId, sourceRegion)],
      conditions: {
        StringEquals: {
          "aws:RequestedRegion": sourceRegion,
          "bedrock:InferenceProfileArn": profileArn,
        },
      },
    },
    {
      resourceArns: [modelArn(modelId, "")],
      conditions: {
        StringEquals: {
          "aws:RequestedRegion": "unspecified",
          "bedrock:InferenceProfileArn": profileArn,
        },
      },
    },
  ];
}

/**
 * Every resource ARN a caller in `scope`'s Region must be allowed to invoke to
 * use `target`. For a cross-Region profile that is the profile plus the
 * foundation model in the source Region and in each Region it routes to.
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
