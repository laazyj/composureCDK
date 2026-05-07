import {
  Distribution,
  type DistributionProps,
  type IOrigin,
  type AddBehaviorOptions,
  type BehaviorOptions,
  type Function as CfFunction,
  type FunctionCode,
  type FunctionEventType,
  type FunctionRuntime,
  type IKeyValueStore,
} from "aws-cdk-lib/aws-cloudfront";
import { type ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type Bucket, type IBucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { RemovalPolicy } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import {
  DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES,
  createBucketBuilder,
  type IBucketBuilder,
} from "@composurecdk/s3";
import type { DistributionAlarmConfig, FunctionAlarmConfig } from "./alarm-config.js";
import { DISTRIBUTION_DEFAULTS } from "./defaults.js";
import { resolveBehaviors } from "./resolve-behaviors.js";
import { pathPatternSlug } from "./behavior-function-alarms.js";
import { buildCloudFrontAlarms } from "./cloudfront-alarm-builder.js";

/**
 * Per-function metadata exposed on {@link DistributionBuilderResult.functions}.
 * Bundles the CDK construct with the behavior context the builder used to
 * create it. Consumers (notably {@link createCloudFrontAlarmBuilder}) use the
 * `pathPattern`, `eventType`, and `recommendedAlarms` fields to reproduce the
 * same recommended alarms in a different stack.
 */
export interface FunctionEntry {
  /** The CloudFront Function created by the distribution builder. */
  function: CfFunction;

  /**
   * The behavior the function is attached to. `null` for the default behavior;
   * otherwise the path pattern (e.g. `"/api/*"`).
   */
  pathPattern: string | null;

  /** The viewer event the function handles. */
  eventType: FunctionEventType;

  /**
   * The {@link InlineFunctionDefinition.recommendedAlarms} value the user
   * supplied for this function. Omitted entirely when the user did not
   * provide one — consumers should treat that as "use defaults".
   */
  recommendedAlarms?: FunctionAlarmConfig | false;
}

/**
 * A CloudFront Function declared inline on a cache behavior. The distribution
 * builder creates the underlying {@link CfFunction} construct and wires it
 * into the behavior's function associations. Recommended alarms for the
 * function are emitted automatically, scoped to the behavior's path pattern.
 *
 * Only inline declarations are supported — there is no "bring your own
 * function" escape hatch, because the whole point of owning the function is
 * to emit path-scoped `FunctionExecutionErrors` / `FunctionValidationErrors`
 * / `FunctionThrottles` alarms that couldn't be emitted from an external
 * `IFunctionRef` (which exposes only an ARN, not a function name).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html
 */
export interface InlineFunctionDefinition {
  /** The viewer event that should invoke the function. */
  eventType: FunctionEventType;

  /** The source for the function — `FunctionCode.fromInline()` or `.fromFile()`. */
  code: FunctionCode;

  /**
   * Explicit physical name for the function. Useful when operators search
   * CloudWatch logs or metrics by function name rather than by ARN. If omitted,
   * CDK generates a name derived from the construct path.
   */
  functionName?: string;

  /**
   * JavaScript runtime.
   * @default FunctionRuntime.JS_2_0
   */
  runtime?: FunctionRuntime;

  /** Optional comment stored on the function resource. */
  comment?: string;

  /**
   * Key-value store to associate with the function. Only supported on the
   * `cloudfront-js-2.0` runtime.
   */
  keyValueStore?: IKeyValueStore;

  /**
   * Per-function alarm configuration. Defaults to the three AWS-recommended
   * alarms (execution errors, validation errors, throttles) each with
   * threshold 0. Set to `false` to disable all alarms for this function, or
   * override individual alarms via their config entry.
   *
   * **Region requirement:** CloudFront metrics are emitted in `us-east-1`
   * only. CloudWatch alarms are regional, so these alarms will only fire if
   * the containing stack is deployed in `us-east-1`. The builder emits a
   * synth-time warning if this isn't the case.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
   */
  recommendedAlarms?: FunctionAlarmConfig | false;
}

/**
 * Configuration for the distribution's default cache behavior.
 *
 * The origin is set separately via {@link IDistributionBuilder.origin}. The
 * `functionAssociations` field from {@link AddBehaviorOptions} is replaced by
 * {@link functions}, which takes {@link InlineFunctionDefinition}s — the
 * builder owns the CloudFront Function constructs so it can emit alarms for
 * them.
 */
export interface DefaultBehaviorConfig extends Omit<AddBehaviorOptions, "functionAssociations"> {
  /**
   * CloudFront Functions to associate with the default behavior. At most one
   * function per {@link FunctionEventType} is allowed.
   */
  functions?: InlineFunctionDefinition[];
}

/**
 * Configuration for a path-pattern cache behavior attached to the distribution
 * via {@link IDistributionBuilder.behavior}.
 *
 * Unlike {@link DefaultBehaviorConfig}, `origin` is required. It may be a
 * concrete {@link IOrigin} or a {@link Resolvable} (typically a {@link ref})
 * for cross-component wiring.
 */
export interface AdditionalBehaviorConfig extends Omit<
  BehaviorOptions,
  "origin" | "functionAssociations"
> {
  /** The origin for this behavior, concrete or resolved at build time. */
  origin: Resolvable<IOrigin>;

  /**
   * CloudFront Functions to associate with this behavior. At most one
   * function per {@link FunctionEventType} is allowed.
   */
  functions?: InlineFunctionDefinition[];
}

/**
 * Configures how CloudFront standard access logs are handled. Pass `false`
 * to disable logging; pass an object to wire a destination, prefix,
 * include cookies, or customize the auto-created sub-builder.
 *
 * `configure` cannot be combined with `destination` — a user-managed
 * destination is not built by this builder.
 */
export type AccessLogsConfig =
  | false
  | {
      destination?: IBucket;
      prefix?: string;
      includeCookies?: boolean;
      /**
       * Customize the auto-created logging sub-builder. Receives a builder
       * pre-seeded with `versioned: false`, `objectOwnership:
       * BUCKET_OWNER_PREFERRED`, `removalPolicy: RETAIN`, and recursive
       * S3 server access logging disabled.
       */
      configure?: (b: IBucketBuilder) => IBucketBuilder;
    };

/**
 * Configuration properties for the CloudFront distribution builder.
 *
 * Extends the CDK {@link DistributionProps} with additional builder-specific
 * options. `defaultBehavior` accepts a {@link DefaultBehaviorConfig} with
 * inline function definitions; additional behaviors are added via the
 * {@link IDistributionBuilder.behavior} method rather than the raw
 * `additionalBehaviors` record.
 *
 * The CDK `enableLogging`, `logBucket`, `logFilePrefix`, and
 * `logIncludesCookies` props are replaced by {@link accessLogs}, which
 * auto-creates a logging bucket with secure defaults by default.
 */
export interface DistributionBuilderProps extends Omit<
  DistributionProps,
  | "defaultBehavior"
  | "additionalBehaviors"
  | "enableLogging"
  | "logBucket"
  | "logFilePrefix"
  | "logIncludesCookies"
  | "certificate"
> {
  /** See {@link AccessLogsConfig}. Defaults to `{ prefix: "logs/" }`. */
  accessLogs?: AccessLogsConfig;

  /**
   * The ACM certificate to associate with the distribution for HTTPS.
   *
   * Accepts a concrete {@link ICertificate} or a {@link Resolvable} —
   * typically a {@link Ref} produced by a composed `@composurecdk/acm`
   * certificate builder. The certificate must be issued in `us-east-1`.
   */
  certificate?: Resolvable<ICertificate>;

  /**
   * Configuration for the default cache behavior. The origin is set via
   * {@link IDistributionBuilder.origin}. Inline CloudFront Functions declared
   * in `functions` are created by the builder and receive path-scoped alarms
   * automatically.
   */
  defaultBehavior?: DefaultBehaviorConfig;

  /**
   * Configuration for AWS-recommended CloudWatch alarms at the **distribution**
   * level (5xx error rate, origin latency).
   *
   * Per-function alarm shapes (`FunctionExecutionErrors`,
   * `FunctionValidationErrors`, `FunctionThrottles`) are configured per
   * function via {@link InlineFunctionDefinition.recommendedAlarms}, because
   * their correct disposition depends on the behavior the function is
   * attached to. The kill switch below (`recommendedAlarms: false`) still
   * applies to function alarms — see below.
   *
   * **Region requirement:** CloudFront metrics are emitted in `us-east-1`
   * only. CloudWatch alarms are regional, so every alarm created by this
   * builder will only fire if the containing stack is deployed in
   * `us-east-1`. The builder emits a synth-time warning if this isn't the
   * case. For multi-region deployments, set `recommendedAlarms: false` here
   * and use {@link createCloudFrontAlarmBuilder} routed to a `us-east-1`
   * stack via `compose().withStacks()`.
   *
   * Set to `false` to disable all recommended alarms (both distribution-level
   * and per-function). Custom alarms added via
   * {@link IDistributionBuilder.addAlarm} are unaffected. To disable a single
   * function's alarms, set `recommendedAlarms: false` on the corresponding
   * {@link InlineFunctionDefinition}.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   *
   * @example Tighter dist-level threshold; function alarms unchanged.
   * ```ts
   * createDistributionBuilder()
   *   .origin(siteOrigin)
   *   .recommendedAlarms({ errorRate: { threshold: 2 } });
   * ```
   *
   * @example Multi-region setup — suppress all alarms here, recreate them in
   * a `us-east-1` stack via {@link createCloudFrontAlarmBuilder}.
   * ```ts
   * createDistributionBuilder()
   *   .origin(siteOrigin)
   *   .recommendedAlarms(false);
   * ```
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
   */
  recommendedAlarms?: DistributionAlarmConfig | false;
}

/**
 * The build output of an {@link IDistributionBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface DistributionBuilderResult {
  /** The CloudFront distribution construct created by the builder. */
  distribution: Distribution;

  /**
   * The S3 bucket created for access logging, or `undefined` if access
   * logging was disabled or the user provided their own bucket.
   */
  accessLogsBucket?: Bucket;

  /**
   * CloudFront Functions created by the builder for inline function
   * definitions, keyed by `<behaviorScope><EventType>` —
   * e.g. `defaultBehaviorViewerRequest`, `behaviorApiStarViewerRequest`.
   * Each entry bundles the {@link CfFunction} with the behavior context
   * (`pathPattern`, `eventType`) and the per-function `recommendedAlarms`
   * config the user supplied. Empty if no inline functions were declared.
   */
  functions: Record<string, FunctionEntry>;

  /**
   * CloudWatch alarms created for the distribution and its inline functions,
   * keyed by alarm name. Distribution-level keys: `errorRate`, `originLatency`.
   * Function-level keys are prefixed by behavior scope and event type —
   * e.g. `defaultBehaviorViewerRequestExecutionErrors`.
   *
   * Includes both recommended alarms and custom alarms added via
   * {@link IDistributionBuilder.addAlarm}. Empty when `recommendedAlarms` is
   * `false` and no custom alarms were added. No alarm actions are configured.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating a CloudFront distribution.
 *
 * Properties from CDK {@link DistributionProps} are exposed as overloaded
 * getter/setter methods. The origin is set via {@link origin}, which accepts
 * a concrete {@link IOrigin} or a {@link Ref} for cross-component wiring.
 * Additional cache behaviors are added via {@link behavior}, which takes a
 * path pattern and a config including its own origin and inline functions.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates a
 * CloudFront distribution, any inline CloudFront Functions declared on its
 * behaviors, and AWS-recommended alarms scoped per-behavior.
 *
 * @example
 * ```ts
 * const cdn = createDistributionBuilder()
 *   .origin(siteOrigin)
 *   .defaultBehavior({
 *     functions: [{
 *       eventType: FunctionEventType.VIEWER_REQUEST,
 *       code: FunctionCode.fromFile({ filePath: "src/edge/rewrite.js" }),
 *     }],
 *   })
 *   .behavior("/api/*", {
 *     origin: apiOrigin,
 *     cachePolicy: CachePolicy.CACHING_DISABLED,
 *     functions: [{
 *       eventType: FunctionEventType.VIEWER_REQUEST,
 *       code: FunctionCode.fromFile({ filePath: "src/edge/api-auth.js" }),
 *     }],
 *   });
 * ```
 */
export type IDistributionBuilder = ITaggedBuilder<DistributionBuilderProps, DistributionBuilder>;

class DistributionBuilder implements Lifecycle<DistributionBuilderResult> {
  props: Partial<DistributionBuilderProps> = {};
  #origin?: Resolvable<IOrigin>;
  readonly #additionalBehaviors = new Map<string, AdditionalBehaviorConfig>();
  readonly #behaviorSlugs = new Map<string, string>();
  readonly #customAlarms: AlarmDefinitionBuilder<Distribution>[] = [];

  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<Distribution>,
    ) => AlarmDefinitionBuilder<Distribution>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Distribution>(key)));
    return this;
  }

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
    this.#origin = origin;
    return this;
  }

  /**
   * Adds an additional cache behavior for a path pattern. The behavior's
   * origin is required (concrete or Resolvable). Any inline functions are
   * created by the builder and receive per-behavior alarms scoped to the
   * path pattern.
   *
   * @throws If a behavior for the same path pattern has already been added.
   */
  behavior(pathPattern: string, config: AdditionalBehaviorConfig): this {
    if (this.#additionalBehaviors.has(pathPattern)) {
      throw new Error(
        `DistributionBuilder: behavior for path pattern "${pathPattern}" is already defined.`,
      );
    }
    // Alarm keys and Function construct ids are derived from a PascalCase slug
    // of the path pattern. Patterns that differ only by stripped characters
    // (e.g. `/*.html` vs `*.html`) would collide downstream at createAlarms() —
    // surface the collision here with the patterns named.
    const slug = pathPatternSlug(pathPattern);
    const existingPattern = this.#behaviorSlugs.get(slug);
    if (existingPattern !== undefined) {
      throw new Error(
        `DistributionBuilder: path pattern "${pathPattern}" produces the same alarm/construct ` +
          `slug ("${slug}") as "${existingPattern}". Pick distinct patterns.`,
      );
    }
    this.#behaviorSlugs.set(slug, pathPattern);
    this.#additionalBehaviors.set(pathPattern, config);
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): DistributionBuilderResult {
    const resolvedOrigin = this.#origin ? resolve(this.#origin, context ?? {}) : undefined;

    if (!resolvedOrigin) {
      throw new Error(
        `DistributionBuilder "${id}" requires an origin. ` +
          `Call .origin() with an IOrigin or a Ref to one.`,
      );
    }

    const {
      accessLogs,
      certificate,
      defaultBehavior: userBehavior,
      recommendedAlarms: alarmConfig,
      ...distProps
    } = this.props;
    const resolvedCertificate = certificate ? resolve(certificate, context ?? {}) : undefined;
    const {
      accessLogs: defaultAccessLogs,
      defaultBehavior: defaultBehaviorDefaults,
      ...cdkDefaults
    } = DISTRIBUTION_DEFAULTS;
    const cfg = accessLogs ?? defaultAccessLogs;

    const { accessLogsBucket, accessLogProps } = resolveAccessLogs(scope, id, cfg);

    const behaviors = resolveBehaviors({
      scope,
      id,
      context: context ?? {},
      defaultOrigin: resolvedOrigin,
      defaultBehavior: userBehavior,
      defaultBehaviorDefaults: defaultBehaviorDefaults ?? {},
      additionalBehaviors: this.#additionalBehaviors,
    });

    const mergedProps = {
      ...cdkDefaults,
      ...accessLogProps,
      ...distProps,
      ...(resolvedCertificate ? { certificate: resolvedCertificate } : {}),
      defaultBehavior: behaviors.defaultBehavior,
      ...(Object.keys(behaviors.additionalBehaviors).length > 0
        ? { additionalBehaviors: behaviors.additionalBehaviors }
        : {}),
    } as DistributionProps;

    const distribution = new Distribution(scope, id, mergedProps);

    // Ensure CloudFront is deleted before the access logs bucket during stack teardown.
    // Without this, CloudFront may still be writing logs while the bucket is being emptied/deleted.
    if (accessLogsBucket) {
      distribution.node.addDependency(accessLogsBucket);
    }

    const alarms = buildCloudFrontAlarms(
      scope,
      id,
      { distribution, functions: behaviors.functions },
      { recommendedAlarms: alarmConfig, customAlarms: this.#customAlarms },
    );

    return {
      distribution,
      accessLogsBucket,
      functions: behaviors.functions,
      alarms,
    };
  }
}

/**
 * Creates a new {@link IDistributionBuilder} for configuring a CloudFront distribution.
 *
 * This is the entry point for defining a CloudFront distribution component.
 * The returned builder exposes every {@link DistributionBuilderProps} property
 * as a fluent setter/getter, plus {@link IDistributionBuilder.origin | origin()}
 * for setting the default origin with Ref support and
 * {@link IDistributionBuilder.behavior | behavior()} for path-pattern behaviors.
 * It implements {@link Lifecycle} for use with {@link compose}.
 *
 * @returns A fluent builder for a CloudFront distribution.
 *
 * @example
 * ```ts
 * const cdn = createDistributionBuilder()
 *   .origin(ref<BucketBuilderResult>("site", (r) =>
 *     S3BucketOrigin.withOriginAccessControl(r.bucket)))
 *   .defaultBehavior({
 *     functions: [{
 *       eventType: FunctionEventType.VIEWER_REQUEST,
 *       code: FunctionCode.fromFile({ filePath: "src/edge/rewrite.js" }),
 *     }],
 *   })
 *   .behavior("/api/*", {
 *     origin: apiOrigin,
 *     cachePolicy: CachePolicy.CACHING_DISABLED,
 *   });
 * ```
 */
export function createDistributionBuilder(): IDistributionBuilder {
  return taggedBuilder<DistributionBuilderProps, DistributionBuilder>(DistributionBuilder);
}

function resolveAccessLogs(
  scope: IConstruct,
  id: string,
  cfg: AccessLogsConfig | undefined,
): {
  accessLogsBucket?: Bucket;
  accessLogProps: Partial<
    Pick<DistributionProps, "enableLogging" | "logBucket" | "logFilePrefix" | "logIncludesCookies">
  >;
} {
  if (cfg === false || cfg === undefined) {
    return { accessLogProps: {} };
  }

  const extras = {
    ...(cfg.prefix !== undefined ? { logFilePrefix: cfg.prefix } : {}),
    ...(cfg.includeCookies !== undefined ? { logIncludesCookies: cfg.includeCookies } : {}),
  };

  if (cfg.destination !== undefined) {
    if (cfg.configure !== undefined) {
      throw new Error(
        "accessLogs: 'configure' cannot be combined with 'destination' — " +
          "the destination bucket is user-managed and not built by this builder.",
      );
    }
    return {
      accessLogProps: {
        enableLogging: true,
        logBucket: cfg.destination,
        ...extras,
      },
    };
  }

  let subBuilder = createBucketBuilder()
    .serverAccessLogs(false)
    .versioned(false)
    // CloudFront standard logging writes via ACLs, which requires BucketOwnerPreferred.
    .objectOwnership(ObjectOwnership.BUCKET_OWNER_PREFERRED)
    .removalPolicy(RemovalPolicy.RETAIN)
    .lifecycleRules(DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES);
  if (cfg.configure) {
    subBuilder = cfg.configure(subBuilder);
  }
  const accessLogsBucket = subBuilder.build(scope, `${id}AccessLogs`).bucket;

  return {
    accessLogsBucket,
    accessLogProps: {
      enableLogging: true,
      logBucket: accessLogsBucket,
      ...extras,
    },
  };
}
