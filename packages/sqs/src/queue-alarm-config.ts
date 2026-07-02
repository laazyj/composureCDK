import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an SQS queue.
 * Which alarms are enabled by default — and their thresholds — depends
 * on the queue's {@link QueueRole}: the primary roles (`"standard"`,
 * `"fifo"`) and the dead-letter roles (`"dlq"`, `"fifo-dlq"`) invert
 * which signals matter. Set an individual alarm to `false` to disable
 * it, or provide an {@link AlarmConfig} to enable it (if off by
 * default) or tune its thresholds (if on by default).
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
   * waiting longer than the configured threshold.
   *
   * On a primary queue this is the primary signal that consumers are
   * falling behind (default threshold: > 300 seconds). On a dead-letter
   * queue it signals messages approaching the end of the queue's
   * `retentionPeriod` unattended (default threshold: 75% of the
   * retention period — see {@link DLQ_ALARM_DEFAULTS}).
   *
   * Metric: `AWS/SQS ApproximateAgeOfOldestMessage`, statistic Maximum,
   * period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateAgeOfOldestMessage?: AlarmConfig | false;

  /**
   * Alarm when the number of in-flight (received but not yet deleted)
   * messages approaches the SQS quota of 120,000 per queue. A breach
   * means new messages will start being rejected.
   *
   * Enabled by default on primary queues (threshold: > 90,000 — 75% of
   * the quota). Disabled by default on dead-letter queues, where nothing
   * is normally in flight.
   *
   * Metric: `AWS/SQS ApproximateNumberOfMessagesNotVisible`, statistic
   * Maximum, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html#quotas-in-flight
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateNumberOfMessagesNotVisible?: AlarmConfig | false;

  /**
   * Alarm when the queue has visible (available-to-receive) messages
   * above the threshold.
   *
   * Disabled by default on a primary queue — messages waiting to be
   * consumed are the normal state, and no generic threshold suits every
   * workload's processing capacity. Enable it explicitly with a
   * threshold sized to your consumers; enabling it on a primary queue
   * without a threshold throws at build.
   *
   * Enabled by default on a dead-letter queue, where any message present
   * is itself the alert (default threshold: > 0). See
   * {@link DLQ_ALARM_DEFAULTS}.
   *
   * Metric: `AWS/SQS ApproximateNumberOfMessagesVisible`, statistic
   * Maximum, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  approximateNumberOfMessagesVisible?: AlarmConfig | false;
}

/**
 * Keys of the recommended SQS alarms a queue builder can create —
 * every {@link QueueAlarmConfig} entry except the `enabled` master
 * switch. Shared between the primary-queue defaults
 * ({@link QUEUE_ALARM_DEFAULTS}) and the dead-letter-queue defaults
 * ({@link DLQ_ALARM_DEFAULTS}) so every builder resolves the same
 * config shape.
 */
export type QueueAlarmKey = Exclude<keyof QueueAlarmConfig, "enabled">;
