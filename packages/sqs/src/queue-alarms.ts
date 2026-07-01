import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { AlarmDefinition, AlarmMetric } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { QueueAlarmConfig, QueueAlarmKey } from "./queue-alarm-config.js";
import { QUEUE_ALARM_DEFAULTS } from "./queue-alarm-defaults.js";
import { DLQ_ALARM_DEFAULTS } from "./dlq-alarm-defaults.js";
import type { QueueRole } from "./queue-role.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Default enablement for each recommended alarm, per queue role. Adding a
 * future role (e.g. FIFO) is purely additive here — one more row, no
 * changes to {@link resolveQueueAlarmDefinitions}.
 */
const ALARM_DEFAULT_ENABLEMENT: Record<QueueRole, Record<QueueAlarmKey, boolean>> = {
  primary: {
    approximateAgeOfOldestMessage: true,
    approximateNumberOfMessagesNotVisible: true,
    approximateNumberOfMessagesVisible: false,
  },
  dlq: DLQ_ALARM_DEFAULTS,
};

/** A recommended alarm's metric factory and role-aware description text. */
interface AlarmSpec {
  key: QueueAlarmKey;
  metric: (queue: IQueue) => AlarmMetric;
  describe: (role: QueueRole, threshold: number) => string;
}

const ALARM_SPECS: AlarmSpec[] = [
  {
    key: "approximateAgeOfOldestMessage",
    metric: (queue) => queue.metricApproximateAgeOfOldestMessage({ period: METRIC_PERIOD }),
    describe: (role, threshold) =>
      role === "dlq"
        ? `Messages have been sitting unattended on this dead-letter queue longer than the ` +
          `threshold — investigate before they age out via the queue's retentionPeriod. ` +
          `Threshold: > ${String(threshold)} seconds in ${METRIC_PERIOD_LABEL}.`
        : `SQS queue's oldest message has been waiting longer than the threshold, ` +
          `indicating consumers are falling behind. Threshold: > ${String(threshold)} seconds in ${METRIC_PERIOD_LABEL}.`,
  },
  {
    key: "approximateNumberOfMessagesNotVisible",
    metric: (queue) => queue.metricApproximateNumberOfMessagesNotVisible({ period: METRIC_PERIOD }),
    describe: (_role, threshold) =>
      `SQS queue's in-flight messages are approaching the 120,000 per-queue quota; ` +
      `further receives will be rejected once the quota is hit. ` +
      `Threshold: > ${String(threshold)} in-flight in ${METRIC_PERIOD_LABEL}.`,
  },
  {
    key: "approximateNumberOfMessagesVisible",
    metric: (queue) => queue.metricApproximateNumberOfMessagesVisible({ period: METRIC_PERIOD }),
    describe: (role, threshold) =>
      role === "dlq"
        ? `Dead-letter queue has messages present — any message here indicates a delivery ` +
          `failure that needs investigation. Threshold: > ${String(threshold)} in ${METRIC_PERIOD_LABEL}.`
        : `Queue has more visible messages waiting than expected for this workload. ` +
          `Threshold: > ${String(threshold)} in ${METRIC_PERIOD_LABEL}.`,
  },
];

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SQS queue.
 *
 * @param role - Which default enablement/thresholds apply. `"dlq"`
 *   inverts which alarms are on by default (see {@link DLQ_ALARM_DEFAULTS});
 *   set via `createQueueBuilder().asDeadLetterQueue()`.
 */
export function resolveQueueAlarmDefinitions(
  queue: IQueue,
  config: QueueAlarmConfig | undefined,
  role: QueueRole = "primary",
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  return ALARM_SPECS.flatMap((spec): AlarmDefinition[] => {
    const userConfig = config?.[spec.key];
    if (userConfig === false) return [];
    if (userConfig === undefined && !ALARM_DEFAULT_ENABLEMENT[role][spec.key]) return [];

    const cfg = resolveAlarmConfig(userConfig, QUEUE_ALARM_DEFAULTS[spec.key]);
    return [
      {
        key: spec.key,
        alarmName: cfg.alarmName,
        metric: spec.metric(queue),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: spec.describe(role, cfg.threshold),
      },
    ];
  });
}

/**
 * Creates AWS-recommended CloudWatch alarms for an SQS queue, merging
 * recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param queue - The SQS queue to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @param role - Which default enablement/thresholds apply; see
 *   {@link resolveQueueAlarmDefinitions}.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export function createQueueAlarms(
  scope: IConstruct,
  id: string,
  queue: IQueue,
  config: QueueAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IQueue>[] = [],
  role: QueueRole = "primary",
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? QUEUE_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveQueueAlarmDefinitions(queue, config, role);
  const custom = customAlarms.map((b) => b.resolve(queue));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
