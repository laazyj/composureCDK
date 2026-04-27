import { HealthCheck, type HealthCheckProps, type IHealthCheck } from "aws-cdk-lib/aws-route53";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { HealthCheckAlarmConfig } from "./health-check-alarm-config.js";
import { buildHealthCheckAlarms } from "./health-check-alarm-builder.js";
import { HEALTH_CHECK_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the Route 53 health-check builder.
 *
 * Extends the CDK {@link HealthCheckProps} with builder-specific options for
 * AWS-recommended CloudWatch alarms.
 */
export interface HealthCheckBuilderProps extends HealthCheckProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates a recommended `healthCheckStatus`
   * alarm matching AWS guidance (`HealthCheckStatus < 1` for one minute,
   * `treatMissingData: breaching`). The alarm can be customised or
   * disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook (or `alarmActionsPolicy`) to apply actions.
   *
   * Note: `AWS/Route53` metrics are emitted only in `us-east-1`. If this
   * builder is used outside `us-east-1`, the synthesised alarm will never
   * receive data — the builder emits a synth-time warning. For non-`us-east-1`
   * stacks, suppress this builder's alarms with `recommendedAlarms: false`
   * and create alarms in a `us-east-1` stack via
   * {@link createHealthCheckAlarmBuilder}.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
   */
  recommendedAlarms?: HealthCheckAlarmConfig | false;
}

/**
 * The build output of an {@link IHealthCheckBuilder}.
 */
export interface HealthCheckBuilderResult {
  /** The Route 53 health check construct created by the builder. */
  healthCheck: HealthCheck;

  /**
   * CloudWatch alarms created for the health check, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added via
   * {@link IHealthCheckBuilder.addAlarm}. Access individual alarms by key
   * (e.g. `result.alarms.healthCheckStatus`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating a Route 53 health check.
 *
 * Each configuration property from the CDK {@link HealthCheckProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * The builder also creates the AWS-recommended `healthCheckStatus`
 * CloudWatch alarm by default. Alarms can be customised or disabled via the
 * `recommendedAlarms` property.
 *
 * @example
 * ```ts
 * const hc = createHealthCheckBuilder()
 *   .type(HealthCheckType.HTTPS)
 *   .fqdn("api.example.com")
 *   .resourcePath("/health");
 * ```
 */
export type IHealthCheckBuilder = IBuilder<HealthCheckBuilderProps, HealthCheckBuilder>;

class HealthCheckBuilder implements Lifecycle<HealthCheckBuilderResult> {
  props: Partial<HealthCheckBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<IHealthCheck>[] = [];

  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<IHealthCheck>,
    ) => AlarmDefinitionBuilder<IHealthCheck>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IHealthCheck>(key)));
    return this;
  }

  build(scope: IConstruct, id: string): HealthCheckBuilderResult {
    const { recommendedAlarms, ...rest } = this.props;

    if (!rest.type) {
      throw new Error(
        `HealthCheckBuilder "${id}" requires a type. Call .type() with a HealthCheckType value.`,
      );
    }

    const mergedProps = {
      ...HEALTH_CHECK_DEFAULTS,
      ...rest,
    } as HealthCheckProps;

    const healthCheck = new HealthCheck(scope, id, mergedProps);

    const alarms = buildHealthCheckAlarms(
      scope,
      id,
      { healthCheck },
      {
        recommendedAlarms,
        customAlarms: this.#customAlarms,
      },
    );

    return { healthCheck, alarms };
  }
}

/**
 * Creates a new {@link IHealthCheckBuilder} for configuring a Route 53
 * health check.
 *
 * @returns A fluent builder for a Route 53 health check.
 *
 * @example
 * ```ts
 * const hc = createHealthCheckBuilder()
 *   .type(HealthCheckType.HTTPS)
 *   .fqdn("api.example.com");
 *
 * const result = hc.build(stack, "ApiHealthCheck");
 * ```
 */
export function createHealthCheckBuilder(): IHealthCheckBuilder {
  return Builder<HealthCheckBuilderProps, HealthCheckBuilder>(HealthCheckBuilder);
}
