import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IHealthCheck } from "aws-cdk-lib/aws-route53";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { HealthCheckAlarmConfig } from "./health-check-alarm-config.js";
import { HEALTH_CHECK_ALARM_DEFAULTS } from "./health-check-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a Route 53 health check.
 *
 * Period and statistic are fixed at the AWS-recommended values
 * (1 minute, Minimum) and not exposed as configuration knobs — they are
 * load-bearing for the recommended semantics ("the worst checker reading
 * per minute"). Threshold, evaluation periods, datapoints, and missing-data
 * behaviour remain user-configurable via {@link HealthCheckAlarmConfig}.
 */
export function resolveHealthCheckAlarmDefinitions(
  healthCheck: IHealthCheck,
  config: HealthCheckAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.healthCheckStatus !== false) {
    const cfg = resolveAlarmConfig(
      config?.healthCheckStatus,
      HEALTH_CHECK_ALARM_DEFAULTS.healthCheckStatus,
    );
    definitions.push({
      key: "healthCheckStatus",
      metric: new Metric({
        namespace: "AWS/Route53",
        metricName: "HealthCheckStatus",
        dimensionsMap: { HealthCheckId: healthCheck.healthCheckId },
        statistic: Stats.MINIMUM,
        period: METRIC_PERIOD,
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Route 53 health check is reporting unhealthy. Threshold: HealthCheckStatus < ${String(cfg.threshold)} (Minimum, 1 minute).`,
    });
  }

  return definitions;
}
