import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import type { QueueAlarmKey } from "./queue-alarm-config.js";

/**
 * Shape of a recommended-alarm default set: an {@link AlarmConfigDefaults}
 * baseline per recommended SQS alarm. Partial — an alarm with no entry
 * has no generic default and requires an explicit threshold when
 * enabled. Implemented by {@link QUEUE_ALARM_DEFAULTS} (primary queues)
 * and {@link DLQ_ALARM_DEFAULTS} (dead-letter queues).
 */
export type QueueAlarmDefaults = Partial<Record<QueueAlarmKey, AlarmConfigDefaults>>;

/**
 * AWS-recommended default alarm configuration for primary
 * (consumer-fed) SQS queues, standard and FIFO alike — since November
 * 2024 FIFO queues share the standard 120,000 in-flight quota, so the
 * same thresholds apply.
 *
 * These are threshold baselines only — which alarms are *enabled* by
 * default differs per builder: dead-letter queues invert the set (see
 * {@link DLQ_ALARM_DEFAULTS}) because any message on a DLQ is itself an
 * alert, whereas a primary queue with messages is normal. There is no
 * entry for `approximateNumberOfMessagesVisible`: no generic threshold
 * suits a primary queue, so enabling it requires an explicit threshold.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 * @see https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-sqs-increases-in-flight-limit-fifo-queues/
 */
export const QUEUE_ALARM_DEFAULTS = {
  /**
   * 5 minutes. Conservative starting point for a "consumer falling
   * behind" alarm. The right value depends on the workload's SLA and
   * `retentionPeriod`; tune via `recommendedAlarms`.
   */
  approximateAgeOfOldestMessage: {
    threshold: 300,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * 90,000 — 75% of the SQS 120,000 in-flight message quota. Proactive
   * guardrail; a breach means the queue is approaching the point where
   * new messages will be rejected.
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/quotas-messages.html#quotas-in-flight
   */
  approximateNumberOfMessagesNotVisible: {
    threshold: 90_000,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
} satisfies QueueAlarmDefaults;
