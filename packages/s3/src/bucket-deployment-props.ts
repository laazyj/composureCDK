import type { BucketDeploymentProps, ISource } from "aws-cdk-lib/aws-s3-deployment";

/**
 * Configuration properties for the S3 bucket deployment builder.
 *
 * Extends the CDK {@link BucketDeploymentProps} but replaces
 * `destinationBucket` and `distribution` with builder-managed fields that
 * support {@link Resolvable} for cross-component wiring via {@link ref}.
 *
 * `sources` is set via the builder's fluent API rather than the constructor.
 */
export interface BucketDeploymentBuilderProps extends Omit<
  BucketDeploymentProps,
  "sources" | "destinationBucket" | "distribution"
> {
  /**
   * The sources from which to deploy content. Typically created with
   * `Source.asset("./path")` or `Source.data("key", "content")`.
   */
  sources?: ISource[];
}
