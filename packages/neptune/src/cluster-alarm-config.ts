import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a Neptune cluster.
 * All applicable alarms are enabled by default with thresholds drawn from
 * the Neptune team's own metric guidance. Set an individual alarm to `false`
 * to disable it, or provide an {@link AlarmConfig} to tune its thresholds.
 *
 * Neptune is not yet covered by the CloudWatch out-of-the-box alarm
 * recommendations table, so these thresholds are anchored to the Neptune
 * User Guide's metrics guidance and the Neptune Well-Architected lens rather
 * than to that table.
 *
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/best-practices-general-metrics.html
 * @see https://docs.aws.amazon.com/prescriptive-guidance/latest/neptune-well-architected-framework/introduction.html
 */
export interface NeptuneClusterAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * Individual alarms can also be disabled via their own entry.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm on sustained high CPU on the cluster's instances — the primary
   * signal of a saturated writer or undersized instance.
   *
   * Metric: `AWS/Neptune CPUUtilization`, statistic Average, period 1 minute.
   * Default threshold: >= 80%.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/cloudwatch-monitoring-instances.html
   */
  cpuUtilization?: AlarmConfig | false;

  /**
   * Alarm when requests are queuing faster than the engine can execute them.
   *
   * Metric: `AWS/Neptune MainRequestQueuePendingRequests`, statistic Average,
   * period 1 minute. Default threshold: > 100 pending requests.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/best-practices-general-metrics.html
   */
  mainRequestQueuePendingRequests?: AlarmConfig | false;

  /**
   * Alarm when the buffer cache hit ratio drops, indicating the working set
   * no longer fits in memory and query latency is dominated by I/O.
   *
   * Metric: `AWS/Neptune BufferCacheHitRatio`, statistic Average, period 1
   * minute. Default threshold: < 99.9%.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/best-practices-general-metrics.html
   */
  bufferCacheHitRatio?: AlarmConfig | false;

  /**
   * Alarm when a read replica falls too far behind the writer. Only emits
   * data when the cluster has at least one replica, so it stays quiet on a
   * single-instance cluster (`TreatMissingData.NOT_BREACHING`).
   *
   * Metric: `AWS/Neptune ClusterReplicaLag`, statistic Average, period 1
   * minute. Default threshold: > 30000 ms.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/cw-metrics.html
   */
  clusterReplicaLag?: AlarmConfig | false;

  /**
   * Alarm when a serverless cluster sustains capacity near its configured
   * ceiling, indicating the max NCU setting is too low or query load is
   * running away. Only created when the cluster is serverless (i.e.
   * `serverlessScalingConfiguration` is set); the default threshold is
   * derived as 90% of the configured `maxCapacity`.
   *
   * Metric: `AWS/Neptune ServerlessDatabaseCapacity`, statistic Average,
   * period 1 minute.
   *
   * @see https://docs.aws.amazon.com/neptune/latest/userguide/neptune-serverless-capacity-scaling.html
   */
  serverlessDatabaseCapacity?: AlarmConfig | false;
}
