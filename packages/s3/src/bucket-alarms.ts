import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { Bucket, BucketMetrics } from "aws-cdk-lib/aws-s3";
import type { IConstruct } from "constructs";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import type { BucketAlarmConfig } from "./alarm-config.js";
import { BUCKET_ALARM_DEFAULTS } from "./alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(5);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minutes`;

/**
 * Creates an S3 request metric with the correct namespace and dimensions.
 */
function s3RequestMetric(
  bucket: Bucket,
  filterId: string,
  metricName: string,
  statistic: string,
): Metric {
  return new Metric({
    namespace: "AWS/S3",
    metricName,
    dimensionsMap: {
      BucketName: bucket.bucketName,
      FilterId: filterId,
    },
    statistic,
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an S3 bucket.
 *
 * Creates alarms for each entry in `metricsConfigs`, keyed as
 * `{alarmType}:{filterId}` (e.g. `serverErrors:EntireBucket`).
 */
export function resolveBucketAlarmDefinitions(
  bucket: Bucket,
  config: BucketAlarmConfig | undefined,
  metricsConfigs: BucketMetrics[],
): AlarmDefinition[] {
  if (config?.enabled === false) return [];
  if (metricsConfigs.length === 0) return [];

  const definitions: AlarmDefinition[] = [];

  for (const metrics of metricsConfigs) {
    const filterId = metrics.id;

    if (config?.serverErrors !== false) {
      const cfg = resolveAlarmConfig(config?.serverErrors, BUCKET_ALARM_DEFAULTS.serverErrors);
      definitions.push({
        key: `serverErrors:${filterId}`,
        metric: s3RequestMetric(bucket, filterId, "5xxErrors", Stats.SUM),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: `S3 bucket is returning server-side errors (filter: ${filterId}). Threshold: > ${String(cfg.threshold)} 5xx errors in ${METRIC_PERIOD_LABEL}.`,
      });
    }

    if (config?.clientErrors !== false) {
      const cfg = resolveAlarmConfig(config?.clientErrors, BUCKET_ALARM_DEFAULTS.clientErrors);
      definitions.push({
        key: `clientErrors:${filterId}`,
        metric: s3RequestMetric(bucket, filterId, "4xxErrors", Stats.SUM),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: `S3 bucket is returning client-side errors (filter: ${filterId}). Threshold: > ${String(cfg.threshold)} 4xx errors in ${METRIC_PERIOD_LABEL}.`,
      });
    }
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an S3 bucket,
 * merging recommended definitions with any custom alarm builders.
 *
 * Alarms are created for each entry in `metricsConfigs` (from
 * {@link BucketProps.metrics}). If no metrics configurations are
 * provided, only custom alarms are created.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param bucket - The S3 bucket to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param metricsConfigs - The bucket's request metrics configurations.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
 */
export function createBucketAlarms(
  scope: IConstruct,
  id: string,
  bucket: Bucket,
  config: BucketAlarmConfig | false | undefined,
  metricsConfigs: BucketMetrics[],
  customAlarms: AlarmDefinitionBuilder<Bucket>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? BUCKET_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveBucketAlarmDefinitions(bucket, config, metricsConfigs);
  const custom = customAlarms.map((b) => b.resolve(bucket));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
