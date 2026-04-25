import { type Distribution } from "aws-cdk-lib/aws-cloudfront";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Annotations, Stack, Token } from "aws-cdk-lib";
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
import type { DistributionAlarmConfig } from "./alarm-config.js";
import { resolveDistributionAlarmDefinitions } from "./distribution-alarms.js";
import { resolveBehaviorFunctionAlarmDefinitions } from "./behavior-function-alarms.js";
import type { DistributionBuilderResult } from "./distribution-builder.js";

/**
 * Configuration properties for {@link createCloudFrontAlarmBuilder}.
 *
 * The standalone alarm builder mirrors the alarm surface that
 * {@link createDistributionBuilder} creates by default. It exists so that
 * alarms can be created in a different stack from the distribution itself —
 * specifically a `us-east-1` stack, since CloudFront emits all metrics there
 * regardless of the distribution's stack region.
 */
export interface CloudFrontAlarmBuilderProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms — distribution-level
   * (5xx error rate, origin latency) and per-function (execution errors,
   * validation errors, throttles).
   *
   * Mirrors {@link DistributionBuilderProps.recommendedAlarms}. Set to
   * `false` to disable all recommended alarms; per-function alarms further
   * respect each function's own {@link InlineFunctionDefinition.recommendedAlarms}
   * value. Custom alarms added via {@link ICloudFrontAlarmBuilder.addAlarm}
   * are unaffected.
   *
   * No alarm actions are configured by default. Use `alarmActionsPolicy` (or
   * an `afterBuild` hook) to wire SNS or other actions onto the resulting
   * alarms.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
   */
  recommendedAlarms?: DistributionAlarmConfig | false;
}

/**
 * The build output of an {@link ICloudFrontAlarmBuilder}.
 */
export interface CloudFrontAlarmBuilderResult {
  /**
   * The CloudWatch alarms created by this builder, keyed by alarm name. Uses
   * the same key scheme as {@link DistributionBuilderResult.alarms}.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for CloudFront-related CloudWatch alarms, decoupled from
 * the distribution itself. Use this when the distribution lives in a stack
 * outside `us-east-1` — route this builder's component into a us-east-1
 * stack via `compose().withStacks()` so the alarms land where CloudFront
 * actually emits metrics.
 *
 * @see {@link createCloudFrontAlarmBuilder}
 */
export type ICloudFrontAlarmBuilder = IBuilder<CloudFrontAlarmBuilderProps, CloudFrontAlarmBuilder>;

/**
 * CloudFront metrics are emitted in `us-east-1` only. CloudWatch alarms are
 * regional, so alarms created in any other region will never receive data.
 * Warn (don't error) when alarms are being created outside `us-east-1`,
 * unless the region is an unresolved token (env-agnostic stack — user knows
 * best).
 */
function warnIfNotUsEast1(scope: IConstruct): void {
  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) return;
  if (region === "us-east-1") return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/cloudfront:alarm-region",
    `CloudFront metrics are emitted in us-east-1 only, but this stack is deployed ` +
      `in "${region}". CloudWatch alarms created here will not fire. Deploy the ` +
      `stack in us-east-1, or use createCloudFrontAlarmBuilder() routed to a ` +
      `us-east-1 stack via compose().withStacks().`,
  );
}

/**
 * Shared alarm-assembly used by both {@link createDistributionBuilder} (in its
 * own stack) and {@link createCloudFrontAlarmBuilder} (typically in a separate
 * `us-east-1` stack). Materializes the recommended distribution-level alarms,
 * the recommended per-function alarms, and any user-supplied custom alarms,
 * emits the region warning if the resulting scope is not in `us-east-1`, and
 * creates the alarm constructs.
 *
 * @internal
 */
export function buildCloudFrontAlarms(
  scope: IConstruct,
  id: string,
  target: Pick<DistributionBuilderResult, "distribution" | "functions">,
  options: {
    recommendedAlarms?: DistributionAlarmConfig | false;
    customAlarms?: AlarmDefinitionBuilder<Distribution>[];
  } = {},
): Record<string, Alarm> {
  const recommended = options.recommendedAlarms;
  const recommendedDefs: AlarmDefinition[] =
    recommended === false || recommended?.enabled === false
      ? []
      : [
          ...resolveDistributionAlarmDefinitions(target.distribution, recommended),
          ...Object.values(target.functions).flatMap((entry) =>
            resolveBehaviorFunctionAlarmDefinitions(
              entry.pathPattern,
              entry.eventType,
              entry.function,
              entry.recommendedAlarms,
            ),
          ),
        ];

  const customAlarmDefs = options.customAlarms?.map((b) => b.resolve(target.distribution)) ?? [];
  const allAlarmDefs = [...recommendedDefs, ...customAlarmDefs];

  if (allAlarmDefs.length > 0) {
    warnIfNotUsEast1(scope);
  }

  return createAlarms(scope, id, allAlarmDefs);
}

class CloudFrontAlarmBuilder implements Lifecycle<CloudFrontAlarmBuilderResult> {
  props: Partial<CloudFrontAlarmBuilderProps> = {};
  #distribution?: Resolvable<DistributionBuilderResult>;
  readonly #customAlarms: AlarmDefinitionBuilder<Distribution>[] = [];

  /**
   * Sets the distribution to alarm on. Pass the result of
   * {@link createDistributionBuilder} (or a {@link Ref} to it). The builder
   * reads the distribution and any inline-function metadata from the result.
   *
   * Pair with `compose().withStacks()` to route this component into a
   * `us-east-1` stack while the distribution itself lives elsewhere — set
   * `crossRegionReferences: true` on both stacks so CDK can wire the
   * `DistributionId` reference automatically.
   */
  distribution(distribution: Resolvable<DistributionBuilderResult>): this {
    this.#distribution = distribution;
    return this;
  }

  /**
   * Adds a custom alarm against the distribution. The configure callback
   * receives a fresh {@link AlarmDefinitionBuilder} pre-set with the alarm's
   * key; configure metric, threshold, comparison and any other options.
   *
   * The created alarm is materialized in this builder's stack — useful for
   * cross-region setups where you want all CloudFront alarms to live with the
   * recommended ones.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<Distribution>,
    ) => AlarmDefinitionBuilder<Distribution>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<Distribution>(key)));
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): CloudFrontAlarmBuilderResult {
    if (!this.#distribution) {
      throw new Error(
        `CloudFrontAlarmBuilder "${id}" requires a distribution. ` +
          `Call .distribution() with a DistributionBuilderResult or a Ref to one.`,
      );
    }
    const distribution = resolve(this.#distribution, context ?? {});
    return {
      alarms: buildCloudFrontAlarms(scope, id, distribution, {
        recommendedAlarms: this.props.recommendedAlarms,
        customAlarms: this.#customAlarms,
      }),
    };
  }
}

/**
 * Creates a new {@link ICloudFrontAlarmBuilder} for materializing CloudFront
 * alarms in a stack separate from the distribution itself.
 *
 * The recommended use is multi-region deployments: the distribution lives in
 * the site's stack (often outside `us-east-1` for latency or compliance
 * reasons), and CloudFront alarms must live in a `us-east-1` stack so they
 * can read the metrics CloudFront emits there.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     cdn: createDistributionBuilder()
 *       .origin(...)
 *       .defaultBehavior({ functions: [{ eventType, code }] })
 *       .recommendedAlarms(false),           // suppress alarms in the dist's own stack
 *
 *     cdnAlarms: createCloudFrontAlarmBuilder()
 *       .distribution(ref<DistributionBuilderResult>("cdn"))
 *       .recommendedAlarms({ errorRate: { threshold: 2 } }),
 *   },
 *   { cdn: [], cdnAlarms: ["cdn"] },
 * )
 *   .withStacks({
 *     cdn:       siteStack,    // eu-west-2
 *     cdnAlarms: certStack,    // us-east-1 (existing ACM stack)
 *   })
 *   .build(app, "App");
 * ```
 *
 * Set `crossRegionReferences: true` on both stacks so CDK can export the
 * `DistributionId` from the site stack and import it in the alarm stack.
 */
export function createCloudFrontAlarmBuilder(): ICloudFrontAlarmBuilder {
  return Builder<CloudFrontAlarmBuilderProps, CloudFrontAlarmBuilder>(CloudFrontAlarmBuilder);
}
