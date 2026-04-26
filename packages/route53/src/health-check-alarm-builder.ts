import { type IHealthCheck } from "aws-cdk-lib/aws-route53";
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
import type { HealthCheckAlarmConfig } from "./health-check-alarm-config.js";
import { resolveHealthCheckAlarmDefinitions } from "./health-check-alarms.js";
import type { HealthCheckBuilderResult } from "./health-check-builder.js";

/**
 * Configuration properties for {@link createHealthCheckAlarmBuilder}.
 *
 * The standalone alarm builder mirrors the alarm surface that
 * {@link createHealthCheckBuilder} creates by default. It exists so that
 * alarms can be created in a different stack from the health check itself —
 * specifically a `us-east-1` stack, since Route 53 emits all health check
 * metrics there regardless of the health check's stack region.
 *
 * @see ADR-0004 — Split-alarm builder pattern for fixed-region metrics
 */
export interface HealthCheckAlarmBuilderProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * Mirrors {@link HealthCheckBuilderProps.recommendedAlarms}. Set to
   * `false` to disable all recommended alarms. Custom alarms added via
   * {@link IHealthCheckAlarmBuilder.addAlarm} are unaffected.
   *
   * No alarm actions are configured by default. Use `alarmActionsPolicy`
   * (or an `afterBuild` hook) to wire SNS or other actions onto the
   * resulting alarms.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
   */
  recommendedAlarms?: HealthCheckAlarmConfig | false;
}

/**
 * The build output of an {@link IHealthCheckAlarmBuilder}.
 */
export interface HealthCheckAlarmBuilderResult {
  /**
   * The CloudWatch alarms created by this builder, keyed by alarm name.
   * Uses the same key scheme as {@link HealthCheckBuilderResult.alarms}.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for Route 53 health-check CloudWatch alarms, decoupled
 * from the health check itself. Use this when the health check lives in a
 * stack outside `us-east-1` — route this component into a `us-east-1` stack
 * via `compose().withStacks()` so the alarms land where Route 53 actually
 * emits metrics.
 *
 * @see {@link createHealthCheckAlarmBuilder}
 */
export type IHealthCheckAlarmBuilder = IBuilder<
  HealthCheckAlarmBuilderProps,
  HealthCheckAlarmBuilder
>;

/**
 * Route 53 health-check metrics are emitted in `us-east-1` only. CloudWatch
 * alarms are regional, so alarms created in any other region will never
 * receive data. Warn (don't error) when alarms are being created outside
 * `us-east-1`, unless the region is an unresolved token (env-agnostic stack
 * — user knows best).
 */
function warnIfNotUsEast1(scope: IConstruct): void {
  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) return;
  if (region === "us-east-1") return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/route53:alarm-region",
    `Route 53 health-check metrics are emitted in us-east-1 only, but this stack is ` +
      `deployed in "${region}". CloudWatch alarms created here will not fire. Deploy the ` +
      `stack in us-east-1, or use createHealthCheckAlarmBuilder() routed to a ` +
      `us-east-1 stack via compose().withStacks().`,
  );
}

/**
 * Shared alarm-assembly used by both {@link createHealthCheckBuilder} (in its
 * own stack) and {@link createHealthCheckAlarmBuilder} (typically in a
 * separate `us-east-1` stack). Materialises the recommended health-check
 * alarm and any user-supplied custom alarms, emits the region warning if the
 * resulting scope is not in `us-east-1`, and creates the alarm constructs.
 *
 * @internal
 */
export function buildHealthCheckAlarms(
  scope: IConstruct,
  id: string,
  target: Pick<HealthCheckBuilderResult, "healthCheck">,
  options: {
    recommendedAlarms?: HealthCheckAlarmConfig | false;
    customAlarms?: AlarmDefinitionBuilder<IHealthCheck>[];
  } = {},
): Record<string, Alarm> {
  const recommended = options.recommendedAlarms;
  const recommendedDefs: AlarmDefinition[] =
    recommended === false || recommended?.enabled === false
      ? []
      : resolveHealthCheckAlarmDefinitions(target.healthCheck, recommended);

  const customAlarmDefs = options.customAlarms?.map((b) => b.resolve(target.healthCheck)) ?? [];
  const allAlarmDefs = [...recommendedDefs, ...customAlarmDefs];

  if (allAlarmDefs.length > 0) {
    warnIfNotUsEast1(scope);
  }

  return createAlarms(scope, id, allAlarmDefs);
}

class HealthCheckAlarmBuilder implements Lifecycle<HealthCheckAlarmBuilderResult> {
  props: Partial<HealthCheckAlarmBuilderProps> = {};
  #healthCheck?: Resolvable<HealthCheckBuilderResult>;
  readonly #customAlarms: AlarmDefinitionBuilder<IHealthCheck>[] = [];

  /**
   * Sets the health check to alarm on. Pass the result of
   * {@link createHealthCheckBuilder} (or a {@link Ref} to it). The builder
   * reads the health check from the result.
   *
   * Pair with `compose().withStacks()` to route this component into a
   * `us-east-1` stack while the health check itself lives elsewhere — set
   * `crossRegionReferences: true` on both stacks so CDK can wire the
   * `HealthCheckId` reference automatically.
   */
  healthCheck(healthCheck: Resolvable<HealthCheckBuilderResult>): this {
    this.#healthCheck = healthCheck;
    return this;
  }

  /**
   * Adds a custom alarm against the health check. The configure callback
   * receives a fresh {@link AlarmDefinitionBuilder} pre-set with the alarm's
   * key; configure metric, threshold, comparison and any other options.
   *
   * The created alarm is materialised in this builder's stack — useful for
   * cross-region setups where you want all health-check alarms to live with
   * the recommended ones.
   */
  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<IHealthCheck>,
    ) => AlarmDefinitionBuilder<IHealthCheck>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IHealthCheck>(key)));
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context?: Record<string, object>,
  ): HealthCheckAlarmBuilderResult {
    if (!this.#healthCheck) {
      throw new Error(
        `HealthCheckAlarmBuilder "${id}" requires a health check. ` +
          `Call .healthCheck() with a HealthCheckBuilderResult or a Ref to one.`,
      );
    }
    const target = resolve(this.#healthCheck, context ?? {});
    return {
      alarms: buildHealthCheckAlarms(scope, id, target, {
        recommendedAlarms: this.props.recommendedAlarms,
        customAlarms: this.#customAlarms,
      }),
    };
  }
}

/**
 * Creates a new {@link IHealthCheckAlarmBuilder} for materialising Route 53
 * health-check alarms in a stack separate from the health check itself.
 *
 * The recommended use is multi-region deployments: the health check lives in
 * the application's stack (in any region — Route 53 health checks are
 * global), and the alarms must live in a `us-east-1` stack so they can read
 * the metrics Route 53 emits there.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     api: createHealthCheckBuilder()
 *       .type(HealthCheckType.HTTPS)
 *       .fqdn("api.example.com")
 *       .recommendedAlarms(false),                  // suppress alarms in the api's own stack
 *
 *     apiAlarms: createHealthCheckAlarmBuilder()
 *       .healthCheck(ref<HealthCheckBuilderResult>("api"))
 *       .recommendedAlarms({ healthCheckStatus: { evaluationPeriods: 2 } }),
 *   },
 *   { api: [], apiAlarms: ["api"] },
 * )
 *   .withStacks({
 *     api:       appStack,         // any region — health checks are global
 *     apiAlarms: monitoringStack,  // us-east-1 — where AWS/Route53 metrics live
 *   })
 *   .build(app, "App");
 * ```
 *
 * Set `crossRegionReferences: true` on both stacks so CDK can export the
 * `HealthCheckId` from the app stack and import it in the alarm stack.
 */
export function createHealthCheckAlarmBuilder(): IHealthCheckAlarmBuilder {
  return Builder<HealthCheckAlarmBuilderProps, HealthCheckAlarmBuilder>(HealthCheckAlarmBuilder);
}
