import { Annotations, Aspects, CfnResource, Stack } from "aws-cdk-lib";
import { CfnDistribution, type Distribution } from "aws-cdk-lib/aws-cloudfront";
import { CfnBucket } from "aws-cdk-lib/aws-s3";
import type { IConstruct } from "constructs";

/**
 * Suppression id for the origin object-expiration relationship guard. Stable and
 * part of the public surface — silence the warning with
 * `Annotations.of(scope).acknowledgeWarning(ORIGIN_OBJECT_EXPIRATION_WARNING_ID)`,
 * so it must not be renamed casually.
 *
 * `scope` must be an *ancestor* of the distribution — the stack is the natural
 * choice. CDK matches an acknowledgement against the annotated node's ancestor
 * prefixes only and never against its own path, so an ack placed on the
 * distribution itself does not suppress the warning.
 */
export const ORIGIN_OBJECT_EXPIRATION_WARNING_ID =
  "@composurecdk/cloudfront:origin-object-expiration";

/**
 * Warns when a bucket serving this distribution's origin carries a bucket-wide,
 * age-based object expiration rule. Such a rule deletes the objects CloudFront
 * is still serving once they reach the configured age — no deployment required
 * to trigger it, and nothing else in the stack signals it before the site 404s.
 *
 * A relationship guard in the sense of ADR-0011, but one whose *pair discovery*
 * must also be deferred to synth. `S3BucketOrigin.withOriginAccessControl()` is
 * declared as returning a bare `IOrigin`, and only the unexported
 * `S3BucketOriginWithOAC` subclass holds the bucket, so `build()` has no
 * sanctioned way to reach it. At synth the linkage is in the template instead:
 * the origin's `domainName` is an `Fn::GetAtt` on the bucket's logical id.
 *
 * Scalar L1 reads only — no construct references, so the guard adds no
 * CloudFormation edge and leaves the `compose()` dependency graph unperturbed.
 */
export function guardOriginObjectExpiration(distribution: Distribution, id: string): void {
  Aspects.of(distribution).add({
    visit(node: IConstruct): void {
      // The Aspect visits the distribution and its subtree; act once, against
      // the distribution itself. The origin bucket is a sibling, not a
      // descendant, so it is reached through the stack rather than by traversal.
      if (node !== distribution) return;

      const stack = Stack.of(distribution);
      const originIds = originBucketLogicalIds(stack, distribution);
      if (originIds.size === 0) return; // imported bucket, cross-stack, or a non-S3 origin

      for (const bucket of stack.node.findAll()) {
        if (!isCfnBucket(bucket) || !originIds.has(stack.getLogicalId(bucket))) continue;

        for (const rule of lifecycleRules(stack, bucket)) {
          if (!isUnscopedObjectExpiration(rule)) continue;

          Annotations.of(distribution).addWarningV2(
            ORIGIN_OBJECT_EXPIRATION_WARNING_ID,
            `DistributionBuilder "${id}": origin bucket "${bucket.node.path}" has lifecycle rule ` +
              `${ruleLabel(rule)}, which expires current object versions across the whole bucket — ` +
              `it will delete the content this distribution serves once it reaches that age, with ` +
              `no deployment needed to trigger it. Scope the rule to a prefix or tag that is not ` +
              `served, or expire noncurrent versions instead (noncurrentVersionExpiration). ` +
              `Acknowledge "${ORIGIN_OBJECT_EXPIRATION_WARNING_ID}" to silence this. ` +
              `See https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html`,
          );
        }
      }
    },
  });
}

/** Narrows to an `AWS::S3::Bucket` L1 without `instanceof` — see ADR-0007/ADR-0011. */
function isCfnBucket(node: IConstruct | undefined): node is CfnBucket {
  return (
    node !== undefined &&
    CfnResource.isCfnResource(node) &&
    node.cfnResourceType === CfnBucket.CFN_RESOURCE_TYPE_NAME
  );
}

/** Narrows to an `AWS::CloudFront::Distribution` L1, by the same idiom. */
function isCfnDistribution(node: IConstruct | undefined): node is CfnDistribution {
  return (
    node !== undefined &&
    CfnResource.isCfnResource(node) &&
    node.cfnResourceType === CfnDistribution.CFN_RESOURCE_TYPE_NAME
  );
}

/**
 * Logical ids of the buckets this distribution takes as origins, recovered from
 * the resolved `Fn::GetAtt` on each origin's `domainName`. Only `domainName` is
 * inspected: an origin carries other `Fn::GetAtt`s (its origin access control,
 * for one) that name resources which are not the origin.
 *
 * Empty when the origin bucket is imported, lives in another stack (a
 * cross-stack reference is an import, not a `GetAtt`), or is not S3-backed —
 * the "stay silent whenever the relationship is not knowable" rule of ADR-0011.
 */
function originBucketLogicalIds(stack: Stack, distribution: Distribution): Set<string> {
  const cfnDistribution = distribution.node.defaultChild;
  if (!isCfnDistribution(cfnDistribution)) return new Set();

  // Resolving the L1 renders it in props (camelCase) form with tokens replaced
  // by their CloudFormation intrinsics — `origins`, not `Origins`.
  const config = stack.resolve(cfnDistribution.distributionConfig) as {
    origins?: { domainName?: unknown }[];
  };

  const ids = new Set<string>();
  for (const origin of config.origins ?? []) {
    const logicalId = getAttLogicalId(origin.domainName);
    if (logicalId !== undefined) ids.add(logicalId);
  }
  return ids;
}

/** The logical id named by an `{ "Fn::GetAtt": [id, attr] }` intrinsic, if the value is one. */
function getAttLogicalId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const getAtt = (value as { "Fn::GetAtt"?: unknown })["Fn::GetAtt"];
  if (!Array.isArray(getAtt) || typeof getAtt[0] !== "string") return undefined;
  return getAtt[0];
}

/**
 * The bucket's final lifecycle rules, read off its L1. `Bucket` sets
 * `lifecycleConfiguration` to a `Lazy`, so it has to be resolved rather than
 * read directly; resolving yields the props (camelCase) form.
 */
function lifecycleRules(stack: Stack, bucket: CfnBucket): CfnBucket.RuleProperty[] {
  const config = stack.resolve(bucket.lifecycleConfiguration) as { rules?: unknown } | undefined;
  const rules = config?.rules;
  return Array.isArray(rules) ? (rules as CfnBucket.RuleProperty[]) : [];
}

/**
 * Whether a rule expires current object versions across the entire bucket.
 *
 * Deliberately narrow. A rule scoped to a prefix, tag, or object size is a
 * considered act on a known subset, and the guard cannot tell whether that
 * subset is served — warning on it would be noise, and a noisy guard gets
 * suppressed before the case that matters arrives. An unscoped expiry on an
 * origin bucket has no such reading.
 *
 * `noncurrentVersionExpiration` is never an offender: it acts only on versions
 * already superseded by a newer PUT or a delete marker, so it cannot reach live
 * content. Nor are `abortIncompleteMultipartUpload`, `expiredObjectDeleteMarker`
 * or `transitions`, none of which delete a current version.
 */
function isUnscopedObjectExpiration(rule: CfnBucket.RuleProperty): boolean {
  if (rule.status !== "Enabled") return false;
  if (rule.expirationInDays === undefined && rule.expirationDate === undefined) return false;
  return !isScoped(rule);
}

/** Whether a rule is confined to a subset of the bucket's objects. */
function isScoped(rule: CfnBucket.RuleProperty): boolean {
  const hasTagFilter = Array.isArray(rule.tagFilters) && rule.tagFilters.length > 0;
  return (
    (rule.prefix !== undefined && rule.prefix !== "") ||
    hasTagFilter ||
    rule.objectSizeGreaterThan !== undefined ||
    rule.objectSizeLessThan !== undefined
  );
}

/** Names the offending rule by id where it has one, else by the expiry it sets. */
function ruleLabel(rule: CfnBucket.RuleProperty): string {
  if (rule.id !== undefined && rule.id !== "") return `"${rule.id}"`;
  return rule.expirationInDays !== undefined
    ? `expiration after ${String(rule.expirationInDays)} days`
    : `expiration on ${String(rule.expirationDate)}`;
}
