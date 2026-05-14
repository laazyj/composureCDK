import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { QueueAlarmConfig } from "./queue-alarm-config.js";
import { QUEUE_ALARM_DEFAULTS } from "./queue-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SQS queue.
 */
export function resolveQueueAlarmDefinitions(
  queue: IQueue,
  config: QueueAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.approximateAgeOfOldestMessage !== false) {
    const cfg = resolveAlarmConfig(
      config?.approximateAgeOfOldestMessage,
      QUEUE_ALARM_DEFAULTS.approximateAgeOfOldestMessage,
    );
    definitions.push({
      key: "approximateAgeOfOldestMessage",
      alarmName: cfg.alarmName,
      metric: queue.metricApproximateAgeOfOldestMessage({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `SQS queue's oldest message has been waiting longer than the threshold, ` +
        `indicating consumers are falling behind. Threshold: > ${String(cfg.threshold)} seconds in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.approximateNumberOfMessagesNotVisible !== false) {
    const cfg = resolveAlarmConfig(
      config?.approximateNumberOfMessagesNotVisible,
      QUEUE_ALARM_DEFAULTS.approximateNumberOfMessagesNotVisible,
    );
    definitions.push({
      key: "approximateNumberOfMessagesNotVisible",
      alarmName: cfg.alarmName,
      metric: queue.metricApproximateNumberOfMessagesNotVisible({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description:
        `SQS queue's in-flight messages are approaching the 120,000 per-queue quota; ` +
        `further receives will be rejected once the quota is hit. ` +
        `Threshold: > ${String(cfg.threshold)} in-flight in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
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
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? QUEUE_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveQueueAlarmDefinitions(queue, config);
  const custom = customAlarms.map((b) => b.resolve(queue));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
