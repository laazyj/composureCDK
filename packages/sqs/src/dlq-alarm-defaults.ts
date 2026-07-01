import type { QueueAlarmKey } from "./queue-alarm-config.js";

/**
 * Default enablement for each recommended SQS alarm when a queue is built
 * in the dead-letter-queue role via `createQueueBuilder().asDeadLetterQueue()`,
 * as opposed to the primary-queue enablement baked into
 * `resolveQueueAlarmDefinitions`. Numeric thresholds are shared with
 * {@link QUEUE_ALARM_DEFAULTS} — only which alarms are created
 * automatically differs, and every entry remains individually
 * overridable via `recommendedAlarms`.
 *
 * Inverted from a primary queue: any message present on a DLQ is itself
 * an alert, so `approximateNumberOfMessagesVisible` flips on. "Consumer
 * falling behind" (`approximateAgeOfOldestMessage`) and "in-flight quota"
 * (`approximateNumberOfMessagesNotVisible`) are meaningless on a queue
 * nothing actively consumes from, so they flip off.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export const DLQ_ALARM_DEFAULTS: Record<QueueAlarmKey, boolean> = {
  approximateAgeOfOldestMessage: false,
  approximateNumberOfMessagesNotVisible: false,
  approximateNumberOfMessagesVisible: true,
};
