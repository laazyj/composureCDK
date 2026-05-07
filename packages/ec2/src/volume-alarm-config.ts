import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an EBS volume.
 * All applicable alarms are enabled by default with AWS-recommended
 * thresholds. Set individual alarms to `false` to disable them, or
 * provide an {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
 */
export interface VolumeAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when a burstable volume's I/O credit balance falls low,
   * indicating the volume is about to be throttled to baseline IOPS or
   * throughput.
   *
   * Only created when the configured `volumeType` is one of the burstable
   * types: `gp2` (IOPS credits), `st1` and `sc1` (throughput credits).
   * For non-burstable types (`gp3`, `io1`, `io2`, `standard`) the metric
   * is not emitted, so the alarm is skipped entirely.
   *
   * Metric: `AWS/EBS BurstBalance`, statistic Average, period 5 minutes.
   * Default threshold: < 20% over 3 consecutive 5-minute windows.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
   * @see https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html#gp2-volume-performance
   */
  burstBalance?: AlarmConfig | false;
}
