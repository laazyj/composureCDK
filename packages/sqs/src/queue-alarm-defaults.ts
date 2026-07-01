import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface QueueAlarmDefaults {
  enabled: true;
  approximateAgeOfOldestMessage: AlarmConfigDefaults;
  approximateNumberOfMessagesNotVisible: AlarmConfigDefaults;
  approximateNumberOfMessagesVisible: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for SQS queues.
 *
 * These are threshold baselines only — which alarms are *enabled* by
 * default (as opposed to requiring an explicit opt-in) depends on the
 * queue's role and is decided in `resolveQueueAlarmDefinitions`. Tuned
 * for primary (consumer-fed) queues; dead-letter queues invert which
 * alarms apply automatically (see {@link DLQ_ALARM_DEFAULTS}) — any
 * message on a DLQ is itself an alert, whereas a primary queue with
 * messages is normal.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export const QUEUE_ALARM_DEFAULTS: QueueAlarmDefaults = {
  enabled: true,

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

  /**
   * 0 — matches the dead-letter-queue semantic of "any message present
   * is notable" (see {@link DLQ_ALARM_DEFAULTS}, where this alarm is
   * enabled by default). Only used as a merge baseline when this alarm
   * is explicitly enabled; on a primary queue, override the threshold
   * to a value sized to your workload's processing capacity.
   */
  approximateNumberOfMessagesVisible: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
