import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an EC2 instance.
 * All alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
 */
export interface InstanceAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when CPU utilization is sustained at a high level.
   *
   * Metric: `AWS/EC2 CPUUtilization`, statistic Average, period 1 minute.
   * Default threshold: > 80% over 5 consecutive minutes.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   */
  cpuUtilization?: AlarmConfig | false;

  /**
   * Alarm when the instance fails its EC2 or system status checks.
   *
   * Metric: `AWS/EC2 StatusCheckFailed`, statistic Sum, period 1 minute.
   * Default threshold: > 0 failures over 2 consecutive minutes.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   */
  statusCheckFailed?: AlarmConfig | false;

  /**
   * Alarm when burstable (T-family) CPU credit balance falls low,
   * indicating the instance is about to be throttled to baseline.
   *
   * Only created when the `instanceType` family is one of: t2, t3, t3a, t4g.
   * For other instance types this alarm is skipped entirely.
   *
   * Metric: `AWS/EC2 CPUCreditBalance`, statistic Minimum, period 5 minutes.
   * Default threshold: < 50 credits over 3 consecutive 5-minute windows.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
   * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html
   */
  cpuCreditBalance?: AlarmConfig | false;
}
