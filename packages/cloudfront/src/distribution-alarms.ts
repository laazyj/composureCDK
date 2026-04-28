import { Duration } from "aws-cdk-lib";
import { ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Distribution } from "aws-cdk-lib/aws-cloudfront";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { DistributionAlarmConfig } from "./alarm-config.js";
import { DISTRIBUTION_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Creates a CloudFront distribution metric with the correct namespace and
 * dimensions (DistributionId + Region=Global).
 */
function distributionMetric(
  distribution: Distribution,
  metricName: string,
  statistic: string,
): Metric {
  return new Metric({
    namespace: "AWS/CloudFront",
    metricName,
    dimensionsMap: {
      DistributionId: distribution.distributionId,
      Region: "Global",
    },
    statistic,
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a CloudFront distribution.
 */
export function resolveDistributionAlarmDefinitions(
  distribution: Distribution,
  config: DistributionAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.errorRate !== false) {
    const cfg = resolveAlarmConfig(config?.errorRate, DISTRIBUTION_ALARM_DEFAULTS.errorRate);
    definitions.push({
      key: "errorRate",
      alarmName: cfg.alarmName,
      metric: distributionMetric(distribution, "5xxErrorRate", Stats.AVERAGE),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront distribution 5xx error rate is elevated. Threshold: > ${String(cfg.threshold)}% in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.originLatency !== false) {
    const cfg = resolveAlarmConfig(
      config?.originLatency,
      DISTRIBUTION_ALARM_DEFAULTS.originLatency,
    );
    definitions.push({
      key: "originLatency",
      alarmName: cfg.alarmName,
      metric: distributionMetric(distribution, "OriginLatency", Stats.percentile(90)),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `CloudFront origin latency is elevated. Threshold: > ${String(cfg.threshold)}ms p90 in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}
