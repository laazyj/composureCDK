import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { TopicAlarmConfig } from "./topic-alarm-config.js";
import { TOPIC_ALARM_DEFAULTS } from "./topic-alarm-defaults.js";
import { guardAlarmSelfNotification } from "./topic-alarm-self-notification-guard.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * What the subscriptions the builder bound have, which decides whether the
 * alarms whose metrics need it are created by default.
 */
export interface TopicSubscriptionFeatures {
  /**
   * A subscription has a dead-letter queue — see
   * {@link TopicAlarmConfig.numberOfNotificationsRedrivenToDlq}.
   */
  hasDeadLetterQueue: boolean;
  /**
   * A subscription has a filter policy — see
   * {@link TopicAlarmConfig.numberOfNotificationsFilteredOutInvalidAttributes}.
   */
  hasFilterPolicy: boolean;
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SNS topic.
 */
export function resolveTopicAlarmDefinitions(
  topic: ITopic,
  config: TopicAlarmConfig | undefined,
  features: TopicSubscriptionFeatures,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];
  // An omitted conditional alarm resolves to defaults (`{}`) only when its metric can emit.
  const dlqDefault = features.hasDeadLetterQueue ? {} : false;
  const filteredOut =
    config?.numberOfNotificationsFilteredOutInvalidAttributes ??
    (features.hasFilterPolicy ? {} : false);
  const redrivenToDlq = config?.numberOfNotificationsRedrivenToDlq ?? dlqDefault;
  const failedToRedriveToDlq = config?.numberOfNotificationsFailedToRedriveToDlq ?? dlqDefault;

  if (config?.numberOfNotificationsFailed !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsFailed,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFailed,
    );
    definitions.push({
      key: "numberOfNotificationsFailed",
      alarmName: cfg.alarmName,
      metric: topic.metricNumberOfNotificationsFailed({ period: METRIC_PERIOD }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS topic is failing to deliver notifications. Threshold: > ${String(cfg.threshold)} failures in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (filteredOut !== false) {
    const cfg = resolveAlarmConfig(
      filteredOut,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFilteredOutInvalidAttributes,
    );
    definitions.push({
      key: "numberOfNotificationsFilteredOutInvalidAttributes",
      alarmName: cfg.alarmName,
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

  if (redrivenToDlq !== false) {
    const cfg = resolveAlarmConfig(
      redrivenToDlq,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsRedrivenToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsRedrivenToDlq",
      alarmName: cfg.alarmName,
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

  if (failedToRedriveToDlq !== false) {
    const cfg = resolveAlarmConfig(
      failedToRedriveToDlq,
      TOPIC_ALARM_DEFAULTS.numberOfNotificationsFailedToRedriveToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsFailedToRedriveToDlq",
      alarmName: cfg.alarmName,
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
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @param features - See {@link TopicSubscriptionFeatures}.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export function createTopicAlarms(
  scope: IConstruct,
  id: string,
  topic: ITopic,
  config: TopicAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<ITopic>[],
  features: TopicSubscriptionFeatures,
): Record<string, Alarm> {
  const recommended = config === false ? [] : resolveTopicAlarmDefinitions(topic, config, features);
  const custom = customAlarms.map((b) => b.resolve(topic));

  const alarms = createAlarms(scope, id, [...recommended, ...custom]);
  for (const [key, alarm] of Object.entries(alarms)) {
    guardAlarmSelfNotification(alarm, topic, id, key);
  }
  return alarms;
}
