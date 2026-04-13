import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { SubscriptionAlarmConfig } from "./subscription-alarm-config.js";
import { SUBSCRIPTION_ALARM_DEFAULTS } from "./subscription-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;
const SNS_NAMESPACE = "AWS/SNS";

function topicMetric(topic: ITopic, metricName: string): Metric {
  return new Metric({
    namespace: SNS_NAMESPACE,
    metricName,
    dimensionsMap: { TopicName: topic.topicName },
    statistic: "Sum",
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SNS subscription. Returns an empty array
 * when no DLQ is attached — the underlying metrics only populate when SNS
 * attempts redrive.
 */
export function resolveSubscriptionAlarmDefinitions(
  topic: ITopic,
  hasDeadLetterQueue: boolean,
  config: SubscriptionAlarmConfig | undefined,
): AlarmDefinition[] {
  if (!hasDeadLetterQueue) return [];
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.numberOfNotificationsRedrivenToDlq !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsRedrivenToDlq,
      SUBSCRIPTION_ALARM_DEFAULTS.numberOfNotificationsRedrivenToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsRedrivenToDlq",
      metric: topicMetric(topic, "NumberOfNotificationsRedrivenToDlq"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS subscription is redriving messages to its dead-letter queue, indicating delivery failures. Threshold: > ${String(cfg.threshold)} redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.numberOfNotificationsFailedToRedriveToDlq !== false) {
    const cfg = resolveAlarmConfig(
      config?.numberOfNotificationsFailedToRedriveToDlq,
      SUBSCRIPTION_ALARM_DEFAULTS.numberOfNotificationsFailedToRedriveToDlq,
    );
    definitions.push({
      key: "numberOfNotificationsFailedToRedriveToDlq",
      metric: topicMetric(topic, "NumberOfNotificationsFailedToRedriveToDlq"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `SNS subscription failed to redrive a message to its dead-letter queue; messages may be lost. Threshold: > ${String(cfg.threshold)} failed redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an SNS subscription.
 *
 * Alarms are only produced when a dead-letter queue is attached — the
 * recommended subscription metrics (`NumberOfNotificationsRedrivenToDlq`,
 * `NumberOfNotificationsFailedToRedriveToDlq`) only emit data when SNS
 * attempts to redrive to a DLQ.
 *
 * The metrics are topic-level (dimension `TopicName`); alarm constructs are
 * scoped under the subscription's id so multiple subscriptions on the same
 * topic do not collide.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param topic - The SNS topic the subscription is attached to.
 * @param deadLetterQueue - The subscription's DLQ, or `undefined` if none.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export function createSubscriptionAlarms(
  scope: IConstruct,
  id: string,
  topic: ITopic,
  deadLetterQueue: IQueue | undefined,
  config: SubscriptionAlarmConfig | false | undefined,
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? SUBSCRIPTION_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const definitions = resolveSubscriptionAlarmDefinitions(
    topic,
    deadLetterQueue !== undefined,
    config,
  );
  return createAlarms(scope, id, definitions);
}
