import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { QueueAlarmDefaults } from "./queue-alarm-defaults.js";
import { QUEUE_ALARM_DEFAULTS } from "./queue-alarm-defaults.js";
import { DLQ_QUEUE_DEFAULTS } from "./dlq-defaults.js";

/**
 * Fraction of a dead-letter queue's `retentionPeriod` at which the
 * `approximateAgeOfOldestMessage` alarm fires by default. Messages older
 * than this have sat unattended for most of their retention window and
 * are approaching silent deletion by SQS — the alarm is the last call to
 * investigate and redrive them.
 */
export const DLQ_AGE_ALARM_RETENTION_RATIO = 0.75;

/**
 * AWS-recommended default alarm configuration for dead-letter queues
 * built in a dead-letter role (`createQueueBuilder("dlq")` /
 * `createQueueBuilder("fifo-dlq")`).
 *
 * The enabled set inverts relative to a primary queue:
 *
 * - `approximateNumberOfMessagesVisible` (> 0) is **on** — any message
 *   on a DLQ indicates a delivery failure that needs investigation.
 * - `approximateAgeOfOldestMessage` is **on**, re-framed: nothing
 *   consumes a DLQ, so instead of "consumers falling behind" it fires
 *   when the oldest message has used {@link DLQ_AGE_ALARM_RETENTION_RATIO}
 *   of the queue's `retentionPeriod` — the threshold below is derived
 *   from the default 14-day retention, and the builder scales it to the
 *   actual retention period at build time.
 * - `approximateNumberOfMessagesNotVisible` is **off** — nothing is
 *   normally in flight on a DLQ. The baseline (shared with
 *   {@link QUEUE_ALARM_DEFAULTS} via spread) applies if explicitly
 *   re-enabled.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export const DLQ_ALARM_DEFAULTS = {
  ...QUEUE_ALARM_DEFAULTS,

  approximateAgeOfOldestMessage: {
    threshold: DLQ_QUEUE_DEFAULTS.retentionPeriod.toSeconds() * DLQ_AGE_ALARM_RETENTION_RATIO,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** 0 — any message on a dead-letter queue is itself the alert. */
  approximateNumberOfMessagesVisible: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
} satisfies QueueAlarmDefaults;
