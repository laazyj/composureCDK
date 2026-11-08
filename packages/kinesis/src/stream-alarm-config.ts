import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a Kinesis data stream.
 * Set an individual alarm to `false` to disable it, or provide an
 * {@link AlarmConfig} to enable it (if off by default) or tune its
 * thresholds (if on by default). Defaults are in
 * {@link STREAM_ALARM_DEFAULTS}.
 *
 * Every alarm uses a 1-minute period and treats missing data as not
 * breaching: producer and consumer metrics are only emitted while the API
 * is called, so an idle stream has no data rather than bad data.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export interface StreamAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the oldest record returned to a `GetRecords` consumer is
   * approaching the end of the stream's `retentionPeriod` — records older
   * than the retention period are deleted before they are read.
   *
   * Default threshold: > 50% of the stream's `retentionPeriod`, in
   * milliseconds, derived at build time, for 15 of 15 datapoints. When the
   * retention period is an unresolved token there is nothing to derive
   * from, so the alarm is skipped with a warning unless a `threshold` is
   * supplied here. A supplied `threshold` always wins.
   *
   * Metric: `AWS/Kinesis GetRecords.IteratorAgeMilliseconds`, statistic
   * Maximum, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  getRecordsIteratorAgeMilliseconds?: AlarmConfig | false;

  /**
   * Alarm when `GetRecords` calls are being throttled for exceeding the
   * stream's read throughput. Stays on in on-demand mode, which still
   * throttles traffic that more than doubles its previous peak within 15
   * minutes, or that exceeds a shard's per-partition-key limit.
   *
   * Default threshold: > 0.01, for 5 of 5 datapoints.
   *
   * Metric: `AWS/Kinesis ReadProvisionedThroughputExceeded`, statistic
   * Average, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  readProvisionedThroughputExceeded?: AlarmConfig | false;

  /**
   * Alarm when `PutRecord` / `PutRecords` writes are being throttled for
   * exceeding the stream's write throughput. Stays on in on-demand mode, for
   * the same reason as {@link readProvisionedThroughputExceeded}.
   *
   * Default threshold: > 0.01, for 5 of 5 datapoints.
   *
   * Metric: `AWS/Kinesis WriteProvisionedThroughputExceeded`, statistic
   * Average, period 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  writeProvisionedThroughputExceeded?: AlarmConfig | false;

  /**
   * Alarm when the share of successful `PutRecord` calls drops: producers
   * are failing to write.
   *
   * Default threshold: < 0.99, for 5 of 5 datapoints.
   *
   * Metric: `AWS/Kinesis PutRecord.Success`, statistic Average, period
   * 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  putRecordSuccess?: AlarmConfig | false;

  /**
   * Alarm when the share of successful `GetRecords` calls drops: consumers
   * are failing to read.
   *
   * Default threshold: < 0.99, for 5 of 5 datapoints.
   *
   * Metric: `AWS/Kinesis GetRecords.Success`, statistic Average, period
   * 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  getRecordsSuccess?: AlarmConfig | false;

  /**
   * Alarm when records in `PutRecords` batches are rejected by internal
   * failures.
   *
   * Disabled by default: occasional internal failures are expected and
   * retried by the producer, and how many a workload tolerates depends on
   * its volume, so no generic threshold fits. Enable it explicitly with a
   * threshold; enabling it without one throws at build. Evaluated over 5 of
   * 5 datapoints unless overridden.
   *
   * Metric: `AWS/Kinesis PutRecords.FailedRecords`, statistic Sum, period
   * 1 minute.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
   */
  putRecordsFailedRecords?: AlarmConfig | false;
}

/**
 * Keys of the recommended Kinesis stream alarms — every
 * {@link StreamAlarmConfig} entry except the `enabled` master switch.
 */
export type StreamAlarmKey = Exclude<keyof StreamAlarmConfig, "enabled">;
