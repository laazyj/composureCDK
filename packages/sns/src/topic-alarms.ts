import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { TopicAlarmConfig } from "./topic-alarm-config.js";
import { TOPIC_ALARM_DEFAULTS } from "./topic-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SNS topic.
 */
export function resolveTopicAlarmDefinitions(
  topic: ITopic,
  config: TopicAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.numberOfNotificationsFailed !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsFailed,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFailed,
    );
    definitions.push({
      key: "numberOfNotificationsFailed",
      metric: topic.metricNumberOfNotificationsFailed({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS topic is failing to deliver notifications. Threshold: > ${String(cfg.threshold)} failures in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.numberOfNotificationsFilteredOutInvalidAttributes !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsFilteredOutInvalidAttributes,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFilteredOutInvalidAttributes,
    );
    definitions.push({
      key: "numberOfNotificationsFilteredOutInvalidAttributes",
      metric: topic.metricNumberOfNotificationsFilteredOutInvalidAttributes({
        period: METRIC_PERIOD,
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS topic messages are being filtered out due to invalid subscription filter policy attributes. Threshold: > ${String(cfg.threshold)} filtered messages in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.numberOfNotificationsRedrivenToDlq !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsRedrivenToDlq,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsRedrivenToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsRedrivenToDlq",
      metric: topic.metric("NumberOfNotificationsRedrivenToDlq", {
        period: METRIC_PERIOD,
        statistic: "Sum",
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS topic is redriving messages to a subscription dead-letter queue, indicating delivery failures. Threshold: > ${String(cfg.threshold)} redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.numberOfNotificationsFailedToRedriveToDlq !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsFailedToRedriveToDlq,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFailedToRedriveToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsFailedToRedriveToDlq",
      metric: topic.metric("NumberOfNotificationsFailedToRedriveToDlq", {
        period: METRIC_PERIOD,
        statistic: "Sum",
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS topic failed to redrive a message to a subscription dead-letter queue; messages may be lost. Threshold: > ${String(cfg.threshold)} failed redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an SNS topic,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param topic - The SNS topic to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export function createTopicAlarms(
  scope: IConstruct,
  id: string,
  topic: ITopic,
  config: TopicAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<ITopic>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? TOPIC_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveTopicAlarmDefinitions(topic, config);
  const custom = customAlarms.map((b) => b.resolve(topic));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
