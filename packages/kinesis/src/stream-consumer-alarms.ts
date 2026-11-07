import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IStreamConsumer } from "aws-cdk-lib/aws-kinesis";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { StreamConsumerAlarmConfig } from "./stream-consumer-alarm-config.js";
import { STREAM_CONSUMER_ALARM_DEFAULTS } from "./stream-consumer-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);

/**
 * `SubscribeToShardEvent.MillisBehindLatest` for one enhanced fan-out consumer.
 * CDK's `StreamConsumer` exposes no metric helpers, so the metric is built
 * directly, keyed by the consumer's `StreamName` and `ConsumerName` dimensions.
 *
 * @see https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html
 */
function millisBehindLatest(consumer: IStreamConsumer): Metric {
  return new Metric({
    namespace: "AWS/Kinesis",
    metricName: "SubscribeToShardEvent.MillisBehindLatest",
    dimensionsMap: {
      StreamName: consumer.stream.streamName,
      ConsumerName: consumer.streamConsumerName,
    },
    statistic: "Average",
    period: METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a Kinesis enhanced fan-out stream consumer.
 */
export function resolveStreamConsumerAlarmDefinitions(
  consumer: IStreamConsumer,
  config: StreamConsumerAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];
  if (config?.subscribeToShardEventMillisBehindLatest === false) return [];

  const cfg = resolveAlarmConfig(
    config?.subscribeToShardEventMillisBehindLatest,
    STREAM_CONSUMER_ALARM_DEFAULTS.subscribeToShardEventMillisBehindLatest,
  );
  return [
    {
      key: "subscribeToShardEventMillisBehindLatest",
      alarmName: cfg.alarmName,
      metric: millisBehindLatest(consumer),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Kinesis enhanced fan-out consumer is falling behind the stream. Threshold: > ${String(cfg.threshold)} ms behind latest (average per minute).`,
    },
  ];
}

/**
 * Creates AWS-recommended CloudWatch alarms for a Kinesis enhanced fan-out
 * stream consumer, merging recommended definitions with any custom alarm
 * builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param consumer - The stream consumer to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export function createStreamConsumerAlarms(
  scope: IConstruct,
  id: string,
  consumer: IStreamConsumer,
  config: StreamConsumerAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IStreamConsumer>[],
): Record<string, Alarm> {
  const recommended =
    config === false ? [] : resolveStreamConsumerAlarmDefinitions(consumer, config);
  const custom = customAlarms.map((b) => b.resolve(consumer));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
