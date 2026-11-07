import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a Kinesis enhanced fan-out
 * stream consumer. Set an individual alarm to `false` to disable it, or provide
 * an {@link AlarmConfig} to tune its thresholds.
 *
 * Set `enabled: false` (or pass `false` as `recommendedAlarms`) to disable the
 * recommended alarms; custom alarms added via `addAlarm()` are still created.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export interface StreamConsumerAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the consumer falls behind the tip of the stream: the delay, in
   * milliseconds, between a record arriving on the stream and the consumer's
   * `SubscribeToShard` subscription delivering it. A sustained breach means
   * the consumer cannot keep up, and records it has not read edge towards the
   * end of the stream's retention period.
   *
   * Default threshold: > 60,000 ms (1 minute), 5 of 5 one-minute periods.
   *
   * Metric: `AWS/Kinesis SubscribeToShardEvent.MillisBehindLatest`, statistic
   * Maximum, dimensions `StreamName` and `ConsumerName`, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   * @see https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html
   */
  subscribeToShardEventMillisBehindLatest?: AlarmConfig | false;
}
