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
import { type Bucket, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Annotations, RemovalPolicy, Stack, Token } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import { createBucketBuilder } from "@composurecdk/s3";
import type { DistributionAlarmConfig, FunctionAlarmConfig } from "./alarm-config.js";
import { resolveDistributionAlarmDefinitions } from "./distribution-alarms.js";
import { DISTRIBUTION_DEFAULTS } from "./defaults.js";
import { resolveBehaviors } from "./resolve-behaviors.js";

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
 * Configuration properties for the CloudFront distribution builder.
 *
 * Extends the CDK {@link DistributionProps} with additional builder-specific
 * options. `defaultBehavior` accepts a {@link DefaultBehaviorConfig} with
 * inline function definitions; additional behaviors are added via the
 * {@link IDistributionBuilder.behavior} method rather than the raw
 * `additionalBehaviors` record.
 *
 * The `enableLogging` CDK prop is replaced by {@link accessLogging}, which
 * auto-creates a logging bucket with secure defaults when enabled.
 */
export interface DistributionBuilderProps extends Omit<
  DistributionProps,
  "defaultBehavior" | "additionalBehaviors" | "enableLogging" | "certificate"
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
   * Scope: this setting controls *distribution-level* alarms only. Per-function
   * alarms (`FunctionExecutionErrors`, `FunctionValidationErrors`,
   * `FunctionThrottles`) are configured independently via each
   * {@link InlineFunctionDefinition.recommendedAlarms}, because their
   * correct disposition depends on the behavior the function is attached to.
   *
   * **Region requirement:** CloudFront metrics are emitted in `us-east-1`
   * only. CloudWatch alarms are regional, so *every* alarm created by this
   * builder (distribution-level and per-function) will only fire if the
   * containing stack is deployed in `us-east-1`. The builder emits a
   * synth-time warning if this isn't the case.
   *
   * By default, the builder creates recommended distribution alarms.
   * Individual alarms can be customized or disabled; set to `false` to
   * disable all distribution-level alarms — **function alarms remain
   * enabled**. To disable function alarms, set `recommendedAlarms: false`
   * on the corresponding {@link InlineFunctionDefinition}.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   *
   * @example
   * ```ts
   * createDistributionBuilder()
   *   .origin(siteOrigin)
   *   .recommendedAlarms(false)          // disables distribution alarms only
   *   .defaultBehavior({
   *     functions: [{
   *       eventType: FunctionEventType.VIEWER_REQUEST,
   *       code,
   *       recommendedAlarms: false,      // must also disable function alarms explicitly
   *     }],
   *   });
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
   *
   * Empty if no inline functions were declared.
   */
  functions: Record<string, CfFunction>;

  /**
   * CloudWatch alarms created for the distribution and its inline functions,
   * keyed by alarm name. Distribution-level keys: `errorRate`, `originLatency`.
   * Function-level keys are prefixed by behavior scope and event type —
   * e.g. `defaultBehaviorViewerRequestExecutionErrors`.
   *
   * Includes both recommended alarms and custom alarms added via
   * {@link IDistributionBuilder.addAlarm}. No alarm actions are configured.
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
export type IDistributionBuilder = IBuilder<DistributionBuilderProps, DistributionBuilder>;

/**
 * CloudFront metrics are emitted in `us-east-1` only. CloudWatch alarms are
 * regional, so alarms created in any other region will never receive data
 * and will never fire. Warn (don't error) the user if this builder is used
 * from a stack deployed outside `us-east-1`, unless the region is an
 * unresolved token (env-agnostic stack — user knows best).
 */
function warnIfNotUsEast1(scope: IConstruct): void {
  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) return;
  if (region === "us-east-1") return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/cloudfront:alarm-region",
    `CloudFront metrics are emitted in us-east-1 only, but this stack is deployed ` +
      `in "${region}". CloudWatch alarms created here will not fire. Deploy the ` +
      `stack in us-east-1, or disable recommended alarms and wire up a cross-region ` +
      `alarm pattern yourself.`,
  );
}

class DistributionBuilder implements Lifecycle<DistributionBuilderResult> {
  props: Partial<DistributionBuilderProps> = {};
  #origin?: Resolvable<IOrigin>;
  readonly #additionalBehaviors = new Map<string, AdditionalBehaviorConfig>();
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
      accessLogging,
      certificate,
      defaultBehavior: userBehavior,
      recommendedAlarms: alarmConfig,
      ...distProps
    } = this.props;
    const resolvedCertificate = certificate ? resolve(certificate, context ?? {}) : undefined;
    const {
      accessLogging: defaultAccessLogging,
      defaultBehavior: defaultBehaviorDefaults,
      ...cdkDefaults
    } = DISTRIBUTION_DEFAULTS;
    const autoAccessLog = (accessLogging ?? defaultAccessLogging) && !distProps.logBucket;

    let accessLogsBucket: Bucket | undefined;
    let accessLogProps = {};

    if (autoAccessLog) {
      accessLogsBucket = createBucketBuilder()
        .accessLogging(false)
        .versioned(false)
        // CloudFront standard logging writes via ACLs, which requires BucketOwnerPreferred.
        .objectOwnership(ObjectOwnership.BUCKET_OWNER_PREFERRED)
        .removalPolicy(RemovalPolicy.RETAIN)
        .build(scope, `${id}AccessLogs`).bucket;
      accessLogProps = {
        enableLogging: true,
        logBucket: accessLogsBucket,
      };
    }

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

    const distributionAlarmDefs: AlarmDefinition[] =
      alarmConfig === false || alarmConfig?.enabled === false
        ? []
        : resolveDistributionAlarmDefinitions(distribution, alarmConfig);
    const customAlarmDefs = this.#customAlarms.map((b) => b.resolve(distribution));

    const allAlarmDefs = [
      ...distributionAlarmDefs,
      ...behaviors.alarmDefinitions,
      ...customAlarmDefs,
    ];

    if (allAlarmDefs.length > 0) {
      warnIfNotUsEast1(scope);
    }

    const alarms = createAlarms(scope, id, allAlarmDefs);

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
  return Builder<DistributionBuilderProps, DistributionBuilder>(DistributionBuilder);
}
