import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { IDatabaseCluster, ServerlessScalingConfiguration } from "@aws-cdk/aws-neptune-alpha";
import type { IConstruct } from "constructs";
import type { AlarmDefinition, AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { NeptuneClusterAlarmConfig } from "./cluster-alarm-config.js";
import { CLUSTER_ALARM_DEFAULTS } from "./cluster-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * Fraction of a serverless cluster's configured `maxCapacity` at which the
 * `serverlessDatabaseCapacity` alarm fires by default.
 */
const SERVERLESS_CAPACITY_ALARM_FRACTION = 0.9;

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for a Neptune cluster. The serverless capacity
 * alarm is only emitted when `serverlessScaling` is provided.
 */
export function resolveClusterAlarmDefinitions(
  cluster: IDatabaseCluster,
  config: NeptuneClusterAlarmConfig | undefined,
  serverlessScaling: ServerlessScalingConfiguration | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.cpuUtilization !== false) {
    const cfg = resolveAlarmConfig(config?.cpuUtilization, CLUSTER_ALARM_DEFAULTS.cpuUtilization);
    definitions.push({
      key: "cpuUtilization",
      alarmName: cfg.alarmName,
      metric: cluster.metric("CPUUtilization", { period: METRIC_PERIOD, statistic: "Average" }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Neptune cluster CPU utilization is high. Threshold: >= ${String(cfg.threshold)}% over ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  if (config?.mainRequestQueuePendingRequests !== false) {
    const cfg = resolveAlarmConfig(
      config?.mainRequestQueuePendingRequests,
      CLUSTER_ALARM_DEFAULTS.mainRequestQueuePendingRequests,
    );
    definitions.push({
      key: "mainRequestQueuePendingRequests",
      alarmName: cfg.alarmName,
      metric: cluster.metric("MainRequestQueuePendingRequests", {
        period: METRIC_PERIOD,
        statistic: "Average",
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Neptune cluster request queue is backing up. Threshold: > ${String(cfg.threshold)} pending requests over ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  if (config?.bufferCacheHitRatio !== false) {
    const cfg = resolveAlarmConfig(
      config?.bufferCacheHitRatio,
      CLUSTER_ALARM_DEFAULTS.bufferCacheHitRatio,
    );
    definitions.push({
      key: "bufferCacheHitRatio",
      alarmName: cfg.alarmName,
      metric: cluster.metric("BufferCacheHitRatio", {
        period: METRIC_PERIOD,
        statistic: "Average",
      }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Neptune cluster buffer cache hit ratio is low; working set may exceed memory. Threshold: < ${String(cfg.threshold)}% over ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  if (config?.clusterReplicaLag !== false) {
    const cfg = resolveAlarmConfig(
      config?.clusterReplicaLag,
      CLUSTER_ALARM_DEFAULTS.clusterReplicaLag,
    );
    definitions.push({
      key: "clusterReplicaLag",
      alarmName: cfg.alarmName,
      metric: cluster.metric("ClusterReplicaLag", { period: METRIC_PERIOD, statistic: "Average" }),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Neptune read replica is lagging the writer. Threshold: > ${String(cfg.threshold)} ms over ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  // Contextual: only meaningful for a serverless cluster, where capacity is
  // measured in NCUs and a ceiling is configured. The threshold defaults to a
  // fraction of the configured maximum.
  if (serverlessScaling !== undefined && config?.serverlessDatabaseCapacity !== false) {
    const cfg = resolveAlarmConfig(
      config?.serverlessDatabaseCapacity,
      CLUSTER_ALARM_DEFAULTS.serverlessDatabaseCapacity,
    );
    const threshold =
      config?.serverlessDatabaseCapacity?.threshold ??
      serverlessScaling.maxCapacity * SERVERLESS_CAPACITY_ALARM_FRACTION;
    definitions.push({
      key: "serverlessDatabaseCapacity",
      alarmName: cfg.alarmName,
      metric: cluster.metric("ServerlessDatabaseCapacity", {
        period: METRIC_PERIOD,
        statistic: "Average",
      }),
      threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `Neptune serverless capacity is sustained near its ${String(serverlessScaling.maxCapacity)} NCU ceiling. Threshold: >= ${String(threshold)} NCU over ${METRIC_PERIOD_LABEL} periods.`,
    });
  }

  return definitions;
}

/**
 * Creates recommended CloudWatch alarms for a Neptune cluster, merging the
 * recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param cluster - The Neptune cluster to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param serverlessScaling - The cluster's serverless scaling config, if any.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 */
export function createClusterAlarms(
  scope: IConstruct,
  id: string,
  cluster: IDatabaseCluster,
  config: NeptuneClusterAlarmConfig | false | undefined,
  serverlessScaling: ServerlessScalingConfiguration | undefined,
  customAlarms: AlarmDefinitionBuilder<IDatabaseCluster>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? CLUSTER_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveClusterAlarmDefinitions(cluster, config, serverlessScaling);
  const custom = customAlarms.map((b) => b.resolve(cluster));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
