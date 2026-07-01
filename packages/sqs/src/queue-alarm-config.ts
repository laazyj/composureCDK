import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Keys of the recommended SQS alarms a {@link createQueueBuilder | QueueBuilder}
 * can create. Shared between the primary-queue defaults
 * ({@link QUEUE_ALARM_DEFAULTS}) and the dead-letter-queue defaults
 * ({@link DLQ_ALARM_DEFAULTS}) so both roles resolve the same config shape.
 */
export type QueueAlarmKey =
  | "approximateAgeOfOldestMessage"
  | "approximateNumberOfMessagesNotVisible"
  | "approximateNumberOfMessagesVisible";

/**
 * Controls which recommended alarms are created for an SQS queue.
 * Which alarms are enabled by default — and their thresholds — depends on
 * the queue's role (primary vs. dead-letter, see
 * {@link createQueueBuilder}'s `.asDeadLetterQueue()`). Set an individual
 * alarm to `false` to disable it regardless of role, or provide an
 * {@link AlarmConfig} to enable it (if off by default) or tune its
 * thresholds (if on by default).
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

  /**
   * Alarm when the queue has visible (available-to-receive) messages
   * above the threshold.
   *
   * Disabled by default on a primary queue — messages waiting to be
   * consumed are the normal state, and no generic threshold suits every
   * workload's processing capacity; enable it explicitly with a
   * threshold sized to your consumers.
   *
   * Enabled by default on a dead-letter queue built via
   * `.asDeadLetterQueue()`, where any message present is itself the
   * alert (default threshold: > 0). See {@link DLQ_ALARM_DEFAULTS}.
   *
   * Metric: `AWS/SQS ApproximateNumberOfMessagesVisible`, statistic
   * Maximum, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateNumberOfMessagesVisible?: AlarmConfig | false;
}
