import { RemovalPolicy } from "aws-cdk-lib";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket, type BucketProps } from "aws-cdk-lib/aws-s3";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { BucketAlarmConfig } from "./alarm-config.js";
import { createBucketAlarms } from "./bucket-alarms.js";
import { BUCKET_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the S3 bucket builder.
 *
 * Extends the CDK {@link BucketProps} with additional builder-specific options.
 */
export interface BucketBuilderProps extends BucketProps {
  /**
   * Whether to automatically create an S3 access logging bucket.
   *
   * When `true`, the builder creates a dedicated logging bucket using
   * {@link createBucketBuilder} (with secure defaults appropriate for log
   * storage) and configures it as the server access logs destination. The
   * logging bucket inherits secure defaults (block public access, encryption,
   * enforceSSL, versioning for log integrity) with `removalPolicy: RETAIN`
   * and access logging disabled to avoid recursion. The created logging
   * bucket is returned in the build result as `accessLogsBucket`.
   *
   * When `false`, no logging bucket is created. You can still provide your
   * own destination via `serverAccessLogsBucket`.
   *
   * This setting is ignored when `serverAccessLogsBucket` is provided — the
   * user-supplied destination takes precedence.
   */
  accessLogging?: boolean;

  /**
   * The prefix applied to server access log object keys when the builder
   * auto-creates a logging bucket.
   *
   * This setting is only used when {@link accessLogging} is `true` and no
   * user-provided `serverAccessLogsBucket` is set.
   *
   * @default "logs/"
   */
  accessLogsPrefix?: string;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * S3 request metric alarms (5xxErrors, 4xxErrors) require
   * [CloudWatch request metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configure-request-metrics-bucket.html)
   * to be enabled on the bucket. Set {@link BucketAlarmConfig.requestMetricsFilterId}
   * to the ID of the request metrics configuration to create these alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
   */
  recommendedAlarms?: BucketAlarmConfig | false;
}

/**
 * The build output of a {@link IBucketBuilder}. Contains the CDK constructs
 * created during {@link Lifecycle.build}, keyed by role.
 */
export interface BucketBuilderResult {
  /** The S3 bucket construct created by the builder. */
  bucket: Bucket;

  /**
   * The S3 bucket created for access logging, or `undefined` if access
   * logging was disabled or the user provided their own destination.
   */
  accessLogsBucket?: Bucket;

  /**
   * CloudWatch alarms created for the bucket, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link IBucketBuilder.addAlarm}. Access individual alarms
   * by key (e.g., `result.alarms.serverErrors`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an Amazon S3 bucket.
 *
 * Each configuration property from the CDK {@link BucketProps} is exposed
 * as an overloaded method: call with a value to set it (returns the builder
 * for chaining), or call with no arguments to read the current value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an S3 bucket with the configured properties and returns a
 * {@link BucketBuilderResult}.
 *
 * @example
 * ```ts
 * const site = createBucketBuilder()
 *   .bucketName("my-website-bucket")
 *   .versioned(false);
 * ```
 */
export type IBucketBuilder = IBuilder<BucketBuilderProps, BucketBuilder>;

class BucketBuilder implements Lifecycle<BucketBuilderResult> {
  props: Partial<BucketBuilderProps> = {};
  private readonly customAlarms: AlarmDefinitionBuilder<Bucket>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<Bucket>) => AlarmDefinitionBuilder<Bucket>,
  ): this {
    this.customAlarms.push(configure(new AlarmDefinitionBuilder<Bucket>(key)));
    return this;
  }

  build(scope: IConstruct, id: string): BucketBuilderResult {
    const {
      accessLogging,
      accessLogsPrefix,
      recommendedAlarms: alarmConfig,
      ...bucketProps
    } = this.props;
    const {
      accessLogging: defaultAccessLogging,
      accessLogsPrefix: defaultLogsPrefix,
      ...cdkDefaults
    } = BUCKET_DEFAULTS;
    const autoAccessLog =
      (accessLogging ?? defaultAccessLogging) && !bucketProps.serverAccessLogsBucket;

    if (accessLogsPrefix !== undefined && !autoAccessLog) {
      throw new Error(
        "Cannot set 'accessLogsPrefix' when access logging is disabled or " +
          "'serverAccessLogsBucket' is provided. Set 'serverAccessLogsPrefix' " +
          "directly when using your own logging bucket.",
      );
    }

    let accessLogsBucket: Bucket | undefined;
    let accessLogProps = {};

    if (autoAccessLog) {
      accessLogsBucket = createBucketBuilder()
        .accessLogging(false)
        .removalPolicy(RemovalPolicy.RETAIN)
        .build(scope, `${id}AccessLogs`).bucket;
      accessLogProps = {
        serverAccessLogsBucket: accessLogsBucket,
        serverAccessLogsPrefix: accessLogsPrefix ?? defaultLogsPrefix,
      };
    }

    const mergedProps = {
      ...cdkDefaults,
      ...accessLogProps,
      ...bucketProps,
      ...autoDeleteProps(bucketProps, BUCKET_DEFAULTS),
    } as BucketProps;

    const bucket = new Bucket(scope, id, mergedProps);

    const alarms = createBucketAlarms(
      scope,
      id,
      bucket,
      alarmConfig,
      bucketProps.metrics ?? [],
      this.customAlarms,
    );

    return {
      bucket,
      accessLogsBucket,
      alarms,
    };
  }
}

/**
 * Returns `{ autoDeleteObjects: true }` when the effective removal policy is
 * `DESTROY` and the user has not explicitly set `autoDeleteObjects`.
 *
 * CDK requires `autoDeleteObjects` to be paired with `removalPolicy: DESTROY`,
 * but forgetting it causes a non-empty-bucket error on stack deletion. This
 * helper bridges that gap so that switching to `DESTROY` Just Works.
 */
function autoDeleteProps(
  userProps: Partial<BucketProps>,
  defaults: Partial<BucketBuilderProps>,
): Partial<BucketProps> {
  const effectivePolicy = userProps.removalPolicy ?? defaults.removalPolicy;
  if (effectivePolicy === RemovalPolicy.DESTROY && userProps.autoDeleteObjects === undefined) {
    return { autoDeleteObjects: true };
  }
  return {};
}

/**
 * Creates a new {@link IBucketBuilder} for configuring an Amazon S3 bucket.
 *
 * This is the entry point for defining an S3 bucket component. The returned
 * builder exposes every {@link BucketProps} property as a fluent setter/getter
 * and implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for an Amazon S3 bucket.
 *
 * @example
 * ```ts
 * const site = createBucketBuilder()
 *   .bucketName("my-site")
 *   .versioned(false);
 *
 * // Use standalone:
 * const result = site.build(stack, "SiteBucket");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { site, cdn: createDistributionBuilder() },
 *   { site: [], cdn: ["site"] },
 * );
 * ```
 */
export function createBucketBuilder(): IBucketBuilder {
  return Builder<BucketBuilderProps, BucketBuilder>(BucketBuilder);
}
