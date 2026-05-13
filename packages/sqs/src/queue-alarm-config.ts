import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an SQS queue.
 * All applicable alarms are enabled by default with AWS-recommended thresholds.
 * Set individual alarms to `false` to disable them, or provide an
 * {@link AlarmConfig} to tune thresholds.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export interface QueueAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the oldest unprocessed message in the queue has been
   * waiting longer than the configured threshold. Primary signal that
   * consumers are falling behind.
   *
   * Metric: `AWS/SQS ApproximateAgeOfOldestMessage`, statistic Maximum,
   * period 1 minute.
   * Default threshold: > 300 seconds (5 minutes).
   *
   * The default is conservative and should be tuned to the queue's
   * SLA and `retentionPeriod`.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateAgeOfOldestMessage?: AlarmConfig | false;

  /**
   * Alarm when the number of in-flight (received but not yet deleted)
   * messages approaches the SQS quota of 120,000 per queue. A breach
   * means new messages will start being rejected.
   *
   * Metric: `AWS/SQS ApproximateNumberOfMessagesNotVisible`, statistic
   * Maximum, period 1 minute.
   * Default threshold: > 90,000 (75% of the in-flight quota).
   *
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/quotas-messages.html#quotas-in-flight
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateNumberOfMessagesNotVisible?: AlarmConfig | false;
}
