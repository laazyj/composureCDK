import { Duration } from "aws-cdk-lib";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { AlarmMetric } from "@composurecdk/cloudwatch";
import { resolveAlarmThresholdBasis } from "@composurecdk/cloudwatch";
import type { QueueAlarmKey } from "./queue-alarm-config.js";
import type { QueueAlarmDefaults } from "./queue-alarm-defaults.js";
import { QUEUE_ALARM_DEFAULTS } from "./queue-alarm-defaults.js";
import { DLQ_AGE_ALARM_RETENTION_RATIO, DLQ_ALARM_DEFAULTS } from "./dlq-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/** Metric factory for each recommended SQS alarm. */
export const QUEUE_ALARM_METRICS: Record<QueueAlarmKey, (queue: IQueue) => AlarmMetric> = {
  approximateAgeOfOldestMessage: (queue) =>
    queue.metricApproximateAgeOfOldestMessage({ period: METRIC_PERIOD }),
  approximateNumberOfMessagesNotVisible: (queue) =>
    queue.metricApproximateNumberOfMessagesNotVisible({ period: METRIC_PERIOD }),
  approximateNumberOfMessagesVisible: (queue) =>
    queue.metricApproximateNumberOfMessagesVisible({ period: METRIC_PERIOD }),
};

/**
 * How a queue builder interprets the recommended-alarm set: which alarms
 * are created without explicit opt-in, the default thresholds each alarm
 * merges against (an alarm with no baseline requires an explicit
 * threshold when enabled), and the description each produces. Primary
 * queues and dead-letter queues need different profiles because the
 * alarm semantics invert — see {@link DLQ_ALARM_DEFAULTS}.
 */
export interface QueueAlarmProfile {
  /** Whether each alarm is created when the user hasn't configured it. */
  enablement: Record<QueueAlarmKey, boolean>;
  /** Default config each alarm merges user overrides against. */
  defaults: QueueAlarmDefaults;
  /** Alarm description, given the resolved threshold. */
  descriptions: Record<QueueAlarmKey, (threshold: number) => string>;
}

const describeInFlight = (threshold: number): string =>
  `SQS queue's in-flight messages are approaching the 120,000 per-queue quota; ` +
  `further receives will be rejected once the quota is hit. ` +
  `Threshold: > ${String(threshold)} in-flight in ${METRIC_PERIOD_LABEL}.`;

/** Recommended-alarm profile for primary (consumer-fed) queues, standard and FIFO. */
export const PRIMARY_ALARM_PROFILE: QueueAlarmProfile = {
  enablement: {
    approximateAgeOfOldestMessage: true,
    approximateNumberOfMessagesNotVisible: true,
    approximateNumberOfMessagesVisible: false,
  },
  defaults: QUEUE_ALARM_DEFAULTS,
  descriptions: {
    approximateAgeOfOldestMessage: (threshold) =>
      `SQS queue's oldest message has been waiting longer than the threshold, ` +
      `indicating consumers are falling behind. Threshold: > ${String(threshold)} seconds in ${METRIC_PERIOD_LABEL}.`,
    approximateNumberOfMessagesNotVisible: describeInFlight,
    approximateNumberOfMessagesVisible: (threshold) =>
      `Queue has more visible messages waiting than expected for this workload. ` +
      `Threshold: > ${String(threshold)} in ${METRIC_PERIOD_LABEL}.`,
  },
};

const DLQ_ALARM_ENABLEMENT: Record<QueueAlarmKey, boolean> = {
  approximateAgeOfOldestMessage: true,
  approximateNumberOfMessagesNotVisible: false,
  approximateNumberOfMessagesVisible: true,
};

const DLQ_ALARM_DESCRIPTIONS: QueueAlarmProfile["descriptions"] = {
  approximateAgeOfOldestMessage: (threshold) =>
    `Dead-letter queue's oldest message is approaching the queue's retentionPeriod — ` +
    `investigate and redrive it before SQS deletes it. ` +
    `Threshold: > ${String(threshold)} seconds in ${METRIC_PERIOD_LABEL}.`,
  approximateNumberOfMessagesNotVisible: describeInFlight,
  approximateNumberOfMessagesVisible: (threshold) =>
    `Dead-letter queue has messages present — any message here indicates a delivery ` +
    `failure that needs investigation. Threshold: > ${String(threshold)} in ${METRIC_PERIOD_LABEL}.`,
};

/**
 * The dead-letter profile when the retention period is an unresolved
 * token: the retention-derived age alarm has no basis to derive from,
 * so it is off (an explicit user threshold still re-enables it); the
 * rest of the DLQ set is unchanged.
 */
const DLQ_TOKEN_RETENTION_ALARM_PROFILE: QueueAlarmProfile = {
  enablement: { ...DLQ_ALARM_ENABLEMENT, approximateAgeOfOldestMessage: false },
  defaults: {
    approximateNumberOfMessagesNotVisible: DLQ_ALARM_DEFAULTS.approximateNumberOfMessagesNotVisible,
    approximateNumberOfMessagesVisible: DLQ_ALARM_DEFAULTS.approximateNumberOfMessagesVisible,
  },
  descriptions: DLQ_ALARM_DESCRIPTIONS,
};

/**
 * Recommended-alarm profile for dead-letter queues. The age alarm's
 * default threshold is {@link DLQ_AGE_ALARM_RETENTION_RATIO} of the
 * queue's resolved `retentionPeriod`, so it keeps firing before messages
 * age out even when retention is tuned. When the retention is an
 * unresolved token there is no basis to derive from — the age alarm is
 * skipped with an acknowledgeable warning (unless explicitly configured
 * with a threshold), per the library-wide derived-threshold convention.
 */
export function dlqAlarmProfile(
  scope: IConstruct,
  retentionPeriod: Duration | undefined,
): QueueAlarmProfile {
  const retentionSeconds = resolveAlarmThresholdBasis({
    scope,
    value: retentionPeriod,
    resolve: (duration) => duration.toSeconds(),
    isUnresolved: (duration) => duration.isUnresolved(),
    warningId: "@composurecdk/sqs:dlq-age-alarm-token-retention",
    alarmLabel: "dead-letter queue message-age",
    suppressHint: "recommendedAlarms({ approximateAgeOfOldestMessage: false })",
  });

  if (retentionSeconds === undefined) return DLQ_TOKEN_RETENTION_ALARM_PROFILE;

  return {
    enablement: DLQ_ALARM_ENABLEMENT,
    defaults: {
      ...DLQ_ALARM_DEFAULTS,
      approximateAgeOfOldestMessage: {
        ...DLQ_ALARM_DEFAULTS.approximateAgeOfOldestMessage,
        threshold: Math.round(retentionSeconds * DLQ_AGE_ALARM_RETENTION_RATIO),
      },
    },
    descriptions: DLQ_ALARM_DESCRIPTIONS,
  };
}
