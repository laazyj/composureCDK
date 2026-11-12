import type { BucketDeploymentProps } from "aws-cdk-lib/aws-s3-deployment";
import type { Resolvable } from "@composurecdk/core";

/**
 * Configuration properties for the S3 bucket deployment builder.
 *
 * Extends the CDK {@link BucketDeploymentProps} but replaces `sources`,
 * `destinationBucket` and `distribution` with builder-managed fields that
 * support {@link Resolvable} for cross-component wiring via {@link ref}.
 */
export interface BucketDeploymentBuilderProps extends Omit<
  BucketDeploymentProps,
  "sources" | "destinationBucket" | "distribution"
> {
  /**
   * The sources from which to deploy content. Typically created with
   * `Source.asset("./path")` or `Source.data("key", "content")`.
   *
   * Accepts a concrete array or a {@link Ref} that resolves to one at build
   * time — for example the sources another component generates. To mix
   * static and resolved sources, build the array inside the ref.
   *
   * The inner type is read from CDK's own prop (ADR-0018).
   */
  sources?: Resolvable<BucketDeploymentProps["sources"]>;
}
