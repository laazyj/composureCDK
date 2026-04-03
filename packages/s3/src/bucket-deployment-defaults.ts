import type { BucketDeploymentBuilderProps } from "./bucket-deployment-props.js";

/**
 * Defaults that apply regardless of whether a CloudFront distribution is
 * present. Split from distribution-specific defaults so the builder can
 * merge without runtime filtering.
 */
const BASE_DEFAULTS: Partial<BucketDeploymentBuilderProps> = {
  /**
   * Remove files from the destination bucket that are not present in the
   * source, keeping the bucket in sync with the deployed assets and
   * preventing stale content from being served.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_evolve_ops_learned_from_experience.html
   */
  prune: true,

  /**
   * Allocate 256 MiB to the deployment Lambda. The CDK default of 128 MiB
   * is insufficient for deployments with more than a handful of files and
   * can cause silent failures or timeouts.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures_avoid_hard_coded_limits.html
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html#memory-limit
   */
  memoryLimit: 256,

  /**
   * Do not retain deployed files when the stack is deleted. This aligns
   * with `prune: true` semantics — the deployment keeps the bucket in
   * sync with the source, so retaining stale files on deletion is
   * inconsistent. The destination bucket's own removal policy governs
   * whether the bucket itself is retained.
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeploymentProps.html#retainondelete
   */
  retainOnDelete: false,
};

/**
 * Defaults that only apply when a CloudFront distribution is configured.
 * CDK throws if `distributionPaths` is set without a distribution.
 */
const DISTRIBUTION_DEFAULTS: Partial<BucketDeploymentBuilderProps> = {
  /**
   * Invalidate all paths by default so that deployed content is immediately
   * visible through CloudFront. Uses a wildcard path which counts as a
   * single invalidation path. For deployments that only change a subset of
   * files, override with specific paths to reduce origin fetches.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_withstand_component_failures_static_stability.html
   */
  distributionPaths: ["/*"],
};

/**
 * Secure, AWS-recommended defaults applied to every S3 BucketDeployment
 * built with {@link createBucketDeploymentBuilder}. Each property can be
 * individually overridden via the builder's fluent API.
 */
export const BUCKET_DEPLOYMENT_DEFAULTS = {
  ...BASE_DEFAULTS,
  ...DISTRIBUTION_DEFAULTS,
};

/**
 * Returns the appropriate defaults based on whether a CloudFront
 * distribution is present. CDK throws if `distributionPaths` is set
 * without a distribution, so distribution-specific defaults are only
 * included when applicable.
 */
export function effectiveDefaults(hasDistribution: boolean): Partial<BucketDeploymentBuilderProps> {
  return hasDistribution ? { ...BASE_DEFAULTS, ...DISTRIBUTION_DEFAULTS } : BASE_DEFAULTS;
}
