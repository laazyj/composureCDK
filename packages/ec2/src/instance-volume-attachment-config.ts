import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a per-attachment EBS
 * volume on an EC2 instance.
 *
 * Default thresholds are sourced from the AWS-recommended CloudWatch
 * alarm guide. Set the master switch or individual alarms to `false` to
 * disable them, or provide an {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
 */
export interface VolumeAttachmentAlarmConfig {
  /**
   * Master switch: set to `false` to disable all per-attachment alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the per-attachment EBS volume status check reports a
   * stalled I/O condition — typically a host or storage-subsystem issue
   * for that specific attachment.
   *
   * Metric: `AWS/EBS VolumeStalledIOCheck`, statistic Maximum,
   * period 1 minute. Default threshold: >= 1 over 10 consecutive minutes.
   *
   * The metric is published only for Nitro-instance attachments. On
   * non-Nitro instances the alarm sits at `INSUFFICIENT_DATA`, which the
   * `treatMissingData: NOT_BREACHING` default makes harmless.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
   */
  volumeStalledIo?: AlarmConfig | false;
}
