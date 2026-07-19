import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { EbsDeviceVolumeType, type IVolume, type Volume } from "aws-cdk-lib/aws-ec2";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { VolumeAlarmConfig } from "./volume-alarm-config.js";
import { VOLUME_ALARM_DEFAULTS } from "./volume-alarm-defaults.js";

/**
 * BurstBalance is published at 5-minute granularity for burstable volume
 * types. A shorter period yields missing data rather than higher resolution.
 *
 * @see https://docs.aws.amazon.com/ebs/latest/userguide/using_cloudwatch_ebs.html
 */
const BURST_METRIC_PERIOD = Duration.minutes(5);
const BURST_METRIC_PERIOD_LABEL = `${String(BURST_METRIC_PERIOD.toMinutes())} minute`;

/**
 * EBS volume types that publish a `BurstBalance` metric. `gp2` accrues IOPS
 * credits; `st1` and `sc1` accrue throughput credits. Other types
 * (`gp3`, `io1`, `io2`, `standard`) have no burst credit model.
 *
 * @see https://docs.aws.amazon.com/ebs/latest/userguide/using_cloudwatch_ebs.html
 */
const BURSTABLE_VOLUME_TYPES: ReadonlySet<EbsDeviceVolumeType> = new Set([
  EbsDeviceVolumeType.GP2,
  EbsDeviceVolumeType.ST1,
  EbsDeviceVolumeType.SC1,
]);

function isBurstableVolumeType(volumeType: EbsDeviceVolumeType | undefined): boolean {
  return volumeType !== undefined && BURSTABLE_VOLUME_TYPES.has(volumeType);
}

function volumeMetric(
  volume: IVolume,
  metricName: string,
  statistic: string,
  period: Duration,
): Metric {
  return new Metric({
    namespace: "AWS/EBS",
    metricName,
    dimensionsMap: { VolumeId: volume.volumeId },
    statistic,
    period,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s, applying contextual logic for the
 * burstable-only credit alarm.
 */
export function resolveVolumeAlarmDefinitions(
  volume: Volume,
  config: VolumeAlarmConfig | undefined,
  volumeType: EbsDeviceVolumeType | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.burstBalance !== false && isBurstableVolumeType(volumeType)) {
    const cfg = resolveAlarmConfig(config?.burstBalance, VOLUME_ALARM_DEFAULTS.burstBalance);
    definitions.push({
      key: "burstBalance",
      alarmName: cfg.alarmName,
      metric: volumeMetric(volume, "BurstBalance", Stats.AVERAGE, BURST_METRIC_PERIOD),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EBS burstable volume burst credit balance is low — baseline-IOPS throttling is imminent. Threshold: < ${String(cfg.threshold)}% (average) over ${String(cfg.evaluationPeriods)} x ${BURST_METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an EBS volume,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param volume - The EBS volume to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param volumeType - Resolved volume type, used to gate the contextual
 *   burst-balance alarm.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
 */
export function createVolumeAlarms(
  scope: IConstruct,
  id: string,
  volume: Volume,
  config: VolumeAlarmConfig | false | undefined,
  volumeType: EbsDeviceVolumeType | undefined,
  customAlarms: AlarmDefinitionBuilder<Volume>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false
      ? []
      : resolveVolumeAlarmDefinitions(volume, config, volumeType);
  const custom = customAlarms.map((b) => b.resolve(volume));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
