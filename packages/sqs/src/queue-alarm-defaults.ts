import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface QueueAlarmDefaults {
  enabled: true;
  approximateAgeOfOldestMessage: AlarmConfigDefaults;
  approximateNumberOfMessagesNotVisible: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for SQS queues.
 *
 * Tuned for primary (consumer-fed) queues. Dead-letter queues need
 * different thresholds — any message on a DLQ is itself an alert,
 * whereas a primary queue with messages is normal.
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
};
