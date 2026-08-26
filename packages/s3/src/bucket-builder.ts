import { RemovalPolicy } from "aws-cdk-lib";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket, BucketEncryption, type BucketProps, type IBucket } from "aws-cdk-lib/aws-s3";
import { type IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { BucketAlarmConfig } from "./alarm-config.js";
import { createBucketAlarms } from "./bucket-alarms.js";
import { DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES, BUCKET_DEFAULTS } from "./defaults.js";

/**
 * Configures how server access logs are handled. Pass `false` to disable
 * logging; pass an object to wire a destination, prefix, or customize the
 * auto-created sub-builder.
 *
 * `configure` cannot be combined with `destination` — a user-managed
 * destination is not built by this builder.
 */
export type ServerAccessLogsConfig =
  | false
  | {
      destination?: IBucket;
      prefix?: string;
      /**
       * Customize the auto-created logging sub-builder. Receives a builder
       * pre-seeded with `versioned: false`, `removalPolicy: RETAIN`, and
       * recursive access logging disabled.
       *
       * The callback receives the build context, so anything `IBucketBuilder`
       * accepts as a `Resolvable` can be a `ref` to a sibling component.
       * Declare that component as a dependency.
       */
      configure?: (b: IBucketBuilder) => IBucketBuilder;
    };

/**
 * Configuration properties for the S3 bucket builder. Extends CDK
 * {@link BucketProps} with builder-specific options.
 */
export interface BucketBuilderProps extends Omit<
  BucketProps,
  "serverAccessLogsBucket" | "serverAccessLogsPrefix" | "encryptionKey"
> {
  /** See {@link ServerAccessLogsConfig}. Defaults to `{ prefix: "logs/" }`. */
  serverAccessLogs?: ServerAccessLogsConfig;

  /**
   * The KMS key used for server-side encryption (SSE-KMS).
   *
   * Accepts a concrete key or a {@link Resolvable} — typically a {@link Ref}
   * to a composed `@composurecdk/kms` key builder, so the key is a component
   * of the system rather than a construct built outside it.
   *
   * Supplying a key implies `BucketEncryption.KMS`: the `S3_MANAGED` default is
   * mutually exclusive with a customer key, so `build()` drops it rather than
   * making you set both (ADR-0009). Setting `encryption` explicitly still wins.
   *
   * The inner type is read from CDK's own prop rather than named as `IKey`, so
   * it tracks the `kms.IKey` → `kms.IKeyRef` migration in either direction
   * (ADR-0018) — see the table in `@composurecdk/kms`'s README.
   */
  encryptionKey?: Resolvable<NonNullable<BucketProps["encryptionKey"]>>;

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
export type IBucketBuilder = ITaggedBuilder<BucketBuilderProps, BucketBuilder>;

class BucketBuilder implements Lifecycle<BucketBuilderResult> {
  props: Partial<BucketBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<Bucket>[] = [];

  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<Bucket>) => AlarmDefinitionBuilder<Bucket>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Bucket>(key)));
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: BucketBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): BucketBuilderResult {
    const {
      serverAccessLogs,
      recommendedAlarms: alarmConfig,
      encryptionKey,
      ...bucketProps
    } = this.props;
    const { serverAccessLogs: defaultServerAccessLogs, ...cdkDefaults } = BUCKET_DEFAULTS;
    const cfg = serverAccessLogs ?? defaultServerAccessLogs;

    const { accessLogsBucket, accessLogProps } = resolveAccessLogs(scope, id, cfg, context);

    const mergedProps = {
      ...cdkDefaults,
      ...accessLogProps,
      ...bucketProps,
      ...encryptionKeyProps(encryptionKey, bucketProps.encryption, context),
      ...autoDeleteProps(bucketProps, BUCKET_DEFAULTS),
    } as BucketProps;

    const bucket = new Bucket(scope, id, mergedProps);

    const alarms = createBucketAlarms(
      scope,
      id,
      bucket,
      alarmConfig,
      bucketProps.metrics ?? [],
      this.#customAlarms,
    );

    return {
      bucket,
      accessLogsBucket,
      alarms,
    };
  }
}

function resolveAccessLogs(
  scope: IConstruct,
  id: string,
  cfg: ServerAccessLogsConfig | undefined,
  context?: Record<string, object>,
): { accessLogsBucket?: Bucket; accessLogProps: Partial<BucketProps> } {
  if (cfg === false || cfg === undefined) {
    return { accessLogProps: {} };
  }

  if (cfg.destination !== undefined) {
    if (cfg.configure !== undefined) {
      throw new Error(
        "serverAccessLogs: 'configure' cannot be combined with 'destination' — " +
          "the destination bucket is user-managed and not built by this builder.",
      );
    }
    return {
      accessLogProps: {
        serverAccessLogsBucket: cfg.destination,
        ...(cfg.prefix !== undefined ? { serverAccessLogsPrefix: cfg.prefix } : {}),
      },
    };
  }

  let subBuilder = createBucketBuilder()
    .serverAccessLogs(false)
    .versioned(false)
    .removalPolicy(RemovalPolicy.RETAIN)
    .lifecycleRules(DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES);
  if (cfg.configure) {
    subBuilder = cfg.configure(subBuilder);
  }
  // Pass the build context down: `IBucketBuilder` widens `encryptionKey` to a
  // `Resolvable`, so a `configure` callback may hand it a `ref()` to a sibling
  // KMS key. Without the context that ref resolves against an empty record and
  // throws "component not found".
  const accessLogsBucket = subBuilder.build(scope, `${id}AccessLogs`, context).bucket;

  return {
    accessLogsBucket,
    accessLogProps: {
      serverAccessLogsBucket: accessLogsBucket,
      ...(cfg.prefix !== undefined ? { serverAccessLogsPrefix: cfg.prefix } : {}),
    },
  };
}

/**
 * Resolves a {@link Resolvable} encryption key and infers the encryption mode
 * it implies.
 *
 * The `BucketEncryption.S3_MANAGED` default is mutually exclusive with a
 * customer-managed key — CDK rejects the pair — and supplying a key is an
 * unambiguous request for SSE-KMS, so the default yields rather than forcing
 * the user to set both (ADR-0009). An explicit `encryption` still wins, and an
 * incompatible explicit pairing is left for CDK to reject.
 */
function encryptionKeyProps(
  encryptionKey: BucketBuilderProps["encryptionKey"],
  userEncryption: BucketEncryption | undefined,
  context: Record<string, object> | undefined,
): Partial<BucketProps> {
  if (encryptionKey === undefined) return {};

  return {
    encryptionKey: resolve(encryptionKey, context),
    ...(userEncryption === undefined ? { encryption: BucketEncryption.KMS } : {}),
  };
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
  return taggedBuilder<BucketBuilderProps, BucketBuilder>(BucketBuilder);
}
