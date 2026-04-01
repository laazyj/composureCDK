import {
  Distribution,
  type DistributionProps,
  type IOrigin,
  type AddBehaviorOptions,
} from "aws-cdk-lib/aws-cloudfront";
import { type Bucket } from "aws-cdk-lib/aws-s3";
import { RemovalPolicy } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { createBucketBuilder } from "@composurecdk/s3";
import { DISTRIBUTION_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the CloudFront distribution builder.
 *
 * Extends the CDK {@link DistributionProps} with additional builder-specific
 * options. The `defaultBehavior` field is replaced with {@link AddBehaviorOptions}
 * (which excludes `origin`) because the origin is set separately via the
 * {@link IDistributionBuilder.origin | origin()} method, which supports
 * {@link Resolvable} for cross-component wiring.
 *
 * The `enableLogging` CDK prop is replaced by {@link accessLogging}, which
 * auto-creates a logging bucket with secure defaults when enabled.
 */
export interface DistributionBuilderProps extends Omit<
  DistributionProps,
  "defaultBehavior" | "enableLogging"
> {
  /**
   * Whether to automatically create an S3 bucket for CloudFront standard
   * access logging.
   *
   * When `true`, the builder creates a logging bucket using
   * {@link createBucketBuilder} (with its secure defaults) and configures it
   * as the distribution's log destination. The created bucket is returned in
   * the build result as `accessLogsBucket`.
   *
   * When `false`, no logging bucket is created. You can still provide your
   * own bucket via `logBucket`.
   *
   * This setting is ignored when `logBucket` is provided — the user-supplied
   * bucket takes precedence.
   */
  accessLogging?: boolean;

  /**
   * Options for the default cache behavior, excluding `origin`.
   *
   * The origin is set via the {@link IDistributionBuilder.origin | origin()}
   * method and injected at build time. All other behavior options (cache
   * policy, function associations, viewer protocol policy, etc.) can be
   * configured here.
   */
  defaultBehavior?: AddBehaviorOptions;
}

/**
 * The build output of a {@link IDistributionBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface DistributionBuilderResult {
  /** The CloudFront distribution construct created by the builder. */
  distribution: Distribution;

  /**
   * The S3 bucket created for access logging, or `undefined` if access
   * logging was disabled or the user provided their own bucket.
   */
  accessLogsBucket?: Bucket;
}

/**
 * A fluent builder for configuring and creating a CloudFront distribution.
 *
 * Configuration properties from CDK {@link DistributionProps} are exposed as
 * overloaded getter/setter methods via the builder proxy. The origin is set
 * via the {@link origin} method, which accepts a concrete {@link IOrigin} or
 * a {@link Ref} for cross-component wiring.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * a CloudFront distribution with the configured properties and returns a
 * {@link DistributionBuilderResult}.
 *
 * @example
 * ```ts
 * const cdn = createDistributionBuilder()
 *   .origin(ref("site", (r: BucketBuilderResult) =>
 *     S3BucketOrigin.withOriginAccessControl(r.bucket)))
 *   .errorResponses([{
 *     httpStatus: 404,
 *     responsePagePath: "/index.html",
 *     responseHttpStatus: 200,
 *   }]);
 * ```
 */
export type IDistributionBuilder = IBuilder<DistributionBuilderProps, DistributionBuilder>;

class DistributionBuilder implements Lifecycle<DistributionBuilderResult> {
  props: Partial<DistributionBuilderProps> = {};
  private _origin?: Resolvable<IOrigin>;

  /**
   * Sets the default origin for the distribution.
   *
   * Accepts a concrete {@link IOrigin} or a {@link Ref} that resolves to one
   * at build time — enabling cross-component wiring with S3 buckets.
   *
   * @param origin - The origin or a Ref to one.
   * @returns This builder for chaining.
   */
  origin(origin: Resolvable<IOrigin>): this {
    this._origin = origin;
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): DistributionBuilderResult {
    const resolvedOrigin = this._origin ? resolve(this._origin, context ?? {}) : undefined;

    if (!resolvedOrigin) {
      throw new Error(
        `DistributionBuilder "${id}" requires an origin. ` +
          `Call .origin() with an IOrigin or a Ref to one.`,
      );
    }

    const { accessLogging, defaultBehavior: userBehavior, ...distProps } = this.props;
    const {
      accessLogging: defaultAccessLogging,
      defaultBehavior: defaultBehavior,
      ...cdkDefaults
    } = DISTRIBUTION_DEFAULTS;
    const autoAccessLog = (accessLogging ?? defaultAccessLogging) && !distProps.logBucket;

    let accessLogsBucket: Bucket | undefined;
    let accessLogProps = {};

    if (autoAccessLog) {
      accessLogsBucket = createBucketBuilder()
        .accessLogging(false)
        .removalPolicy(RemovalPolicy.RETAIN)
        .build(scope, `${id}AccessLogs`).bucket;
      accessLogProps = {
        enableLogging: true,
        logBucket: accessLogsBucket,
      };
    }

    const mergedProps = {
      ...cdkDefaults,
      ...accessLogProps,
      ...distProps,
      defaultBehavior: {
        ...defaultBehavior,
        ...userBehavior,
        origin: resolvedOrigin,
      },
    } as DistributionProps;

    return {
      distribution: new Distribution(scope, id, mergedProps),
      accessLogsBucket,
    };
  }
}

/**
 * Creates a new {@link IDistributionBuilder} for configuring a CloudFront distribution.
 *
 * This is the entry point for defining a CloudFront distribution component.
 * The returned builder exposes every {@link DistributionBuilderProps} property
 * as a fluent setter/getter, plus {@link IDistributionBuilder.origin | origin()}
 * for setting the default origin with Ref support. It implements {@link Lifecycle}
 * for use with {@link compose}.
 *
 * @returns A fluent builder for a CloudFront distribution.
 *
 * @example
 * ```ts
 * const cdn = createDistributionBuilder()
 *   .origin(ref("site", (r: BucketBuilderResult) =>
 *     S3BucketOrigin.withOriginAccessControl(r.bucket)))
 *   .comment("Community website CDN");
 *
 * // Use standalone:
 * const result = cdn.build(stack, "CDN");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { site: createBucketBuilder(), cdn },
 *   { site: [], cdn: ["site"] },
 * );
 * ```
 */
export function createDistributionBuilder(): IDistributionBuilder {
  return Builder<DistributionBuilderProps, DistributionBuilder>(DistributionBuilder);
}
