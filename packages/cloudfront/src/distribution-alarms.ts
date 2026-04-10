import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Distribution } from "aws-cdk-lib/aws-cloudfront";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
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

/**
 * Creates AWS-recommended CloudWatch alarms for a CloudFront distribution,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param distribution - The CloudFront distribution to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
 */
export function createDistributionAlarms(
  scope: IConstruct,
  id: string,
  distribution: Distribution,
  config: DistributionAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<Distribution>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? DISTRIBUTION_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveDistributionAlarmDefinitions(distribution, config);
  const custom = customAlarms.map((b) => b.resolve(distribution));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
