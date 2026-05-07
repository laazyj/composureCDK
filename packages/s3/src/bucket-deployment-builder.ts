import { BucketDeployment, type BucketDeploymentProps } from "aws-cdk-lib/aws-s3-deployment";
import { type IBucket } from "aws-cdk-lib/aws-s3";
import { type IDistribution } from "aws-cdk-lib/aws-cloudfront";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { effectiveDefaults } from "./bucket-deployment-defaults.js";
import { type BucketDeploymentBuilderProps } from "./bucket-deployment-props.js";

/**
 * The build output of a {@link IBucketDeploymentBuilder}.
 */
export interface BucketDeploymentBuilderResult {
  /** The CDK BucketDeployment construct created by the builder. */
  deployment: BucketDeployment;

  /**
   * The CloudWatch LogGroup created for the deployment's backing Lambda,
   * or `undefined` if the user provided their own via the `logGroup`
   * property.
   *
   * By default the builder creates a managed LogGroup using
   * {@link createLogGroupBuilder} with well-architected defaults (retention
   * policy, removal policy). This prevents the backing Lambda from
   * creating an auto-managed log group with infinite retention.
   *
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeploymentProps.html#loggroup
   */
  logGroup?: LogGroup;
}

/**
 * A fluent builder for configuring and creating an S3 BucketDeployment.
 *
 * Each configuration property from the CDK {@link BucketDeploymentProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * The `destinationBucket` and `distribution` are set via dedicated methods
 * that accept {@link Resolvable} values for cross-component wiring.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}.
 *
 * @example
 * ```ts
 * const deploy = createBucketDeploymentBuilder()
 *   .sources([Source.asset("./site")])
 *   .destinationBucket(ref("site", (r: BucketBuilderResult) => r.bucket))
 *   .distribution(ref("cdn", (r: DistributionBuilderResult) => r.distribution))
 *   .distributionPaths(["/*"]);
 * ```
 */
export type IBucketDeploymentBuilder = ITaggedBuilder<
  BucketDeploymentBuilderProps,
  BucketDeploymentBuilder
>;

class BucketDeploymentBuilder implements Lifecycle<BucketDeploymentBuilderResult> {
  props: Partial<BucketDeploymentBuilderProps> = {};
  #destinationBucket?: Resolvable<IBucket>;
  #distribution?: Resolvable<IDistribution>;

  /**
   * Sets the destination bucket for the deployment.
   *
   * Accepts a concrete {@link IBucket} or a {@link Ref} that resolves to one
   * at build time.
   *
   * @param bucket - The bucket or a Ref to one.
   * @returns This builder for chaining.
   */
  destinationBucket(bucket: Resolvable<IBucket>): this {
    this.#destinationBucket = bucket;
    return this;
  }

  /**
   * Sets the CloudFront distribution to invalidate on deployment.
   *
   * Accepts a concrete {@link IDistribution} or a {@link Ref} that resolves
   * to one at build time. This is optional — deployments can target a bucket
   * without CloudFront invalidation.
   *
   * @param distribution - The distribution or a Ref to one.
   * @returns This builder for chaining.
   */
  distribution(distribution: Resolvable<IDistribution>): this {
    this.#distribution = distribution;
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): BucketDeploymentBuilderResult {
    const ctx = context ?? {};

    const resolvedBucket = this.#destinationBucket
      ? resolve(this.#destinationBucket, ctx)
      : undefined;

    if (!resolvedBucket) {
      throw new Error(
        `BucketDeploymentBuilder "${id}" requires a destination bucket. ` +
          `Call .destinationBucket() with an IBucket or a Ref to one.`,
      );
    }

    const { sources, ...deployProps } = this.props;

    if (!sources || sources.length === 0) {
      throw new Error(
        `BucketDeploymentBuilder "${id}" requires at least one source. ` +
          `Call .sources() with an array of ISource.`,
      );
    }

    const resolvedDistribution = this.#distribution ? resolve(this.#distribution, ctx) : undefined;

    // Auto-create a managed LogGroup for the deployment's backing Lambda
    // unless the user supplied their own, matching the Lambda builder pattern.
    let logGroup: LogGroup | undefined;
    let logGroupProps = {};

    if (!deployProps.logGroup) {
      logGroup = createLogGroupBuilder().build(scope, `${id}LogGroup`).logGroup;
      logGroupProps = { logGroup };
    }

    const mergedProps = {
      ...effectiveDefaults(!!resolvedDistribution),
      ...logGroupProps,
      ...deployProps,
      ...(resolvedDistribution ? { distribution: resolvedDistribution } : {}),
      sources,
      destinationBucket: resolvedBucket,
    } as BucketDeploymentProps;

    return {
      deployment: new BucketDeployment(scope, id, mergedProps),
      logGroup,
    };
  }
}

/**
 * Creates a new {@link IBucketDeploymentBuilder} for deploying content to an
 * S3 bucket with optional CloudFront cache invalidation.
 *
 * This is the entry point for defining an S3 deployment component. The
 * returned builder exposes {@link BucketDeploymentBuilderProps} properties as
 * fluent setters/getters, plus {@link IBucketDeploymentBuilder.destinationBucket | destinationBucket()}
 * and {@link IBucketDeploymentBuilder.distribution | distribution()} for
 * cross-component wiring with Ref support. It implements {@link Lifecycle}
 * for use with {@link compose}.
 *
 * @returns A fluent builder for an S3 BucketDeployment.
 *
 * @example
 * ```ts
 * const deploy = createBucketDeploymentBuilder()
 *   .sources([Source.asset("./site")])
 *   .destinationBucket(ref("site", (r: BucketBuilderResult) => r.bucket))
 *   .distribution(ref("cdn", (r: DistributionBuilderResult) => r.distribution))
 *   .distributionPaths(["/*"]);
 *
 * // Use standalone:
 * const result = deploy.build(stack, "Deploy");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { site: createBucketBuilder(), cdn: createDistributionBuilder(), deploy },
 *   { site: [], cdn: ["site"], deploy: ["site", "cdn"] },
 * );
 * ```
 */
export function createBucketDeploymentBuilder(): IBucketDeploymentBuilder {
  return taggedBuilder<BucketDeploymentBuilderProps, BucketDeploymentBuilder>(
    BucketDeploymentBuilder,
  );
}
