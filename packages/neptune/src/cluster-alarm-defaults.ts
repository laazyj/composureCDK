import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface ClusterAlarmDefaults {
  enabled: true;
  cpuUtilization: AlarmConfigDefaults;
  mainRequestQueuePendingRequests: AlarmConfigDefaults;
  bufferCacheHitRatio: AlarmConfigDefaults;
  clusterReplicaLag: AlarmConfigDefaults;
  /** `threshold` is unused — the real value is derived from `maxCapacity` at build time. */
  serverlessDatabaseCapacity: AlarmConfigDefaults;
}

/**
 * Recommended default alarm configuration for Neptune clusters. Thresholds
 * follow the Neptune team's metric guidance; Neptune is absent from the
 * CloudWatch recommended-alarms table, so no anchor to that page exists.
 *
 * @see https://docs.aws.amazon.com/neptune/latest/userguide/best-practices-general-metrics.html
 */
export const CLUSTER_ALARM_DEFAULTS: ClusterAlarmDefaults = {
  enabled: true,

  /** Sustained CPU at/above 80% over several minutes signals saturation. */
  cpuUtilization: {
    threshold: 80,
    evaluationPeriods: 5,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** A growing request backlog means the engine cannot keep up with load. */
  mainRequestQueuePendingRequests: {
    threshold: 100,
    evaluationPeriods: 5,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** A cache hit ratio below 99.9% indicates the working set exceeds memory. */
  bufferCacheHitRatio: {
    threshold: 99.9,
    evaluationPeriods: 15,
    datapointsToAlarm: 10,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Replica lag over 30s risks stale reads; quiet on single-instance clusters. */
  clusterReplicaLag: {
    threshold: 30_000,
    evaluationPeriods: 5,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  // `threshold` is a required-shape filler: the serverless capacity alarm
  // always derives its threshold from `maxCapacity` at build time (or a user
  // override), so this value is never read. The evaluation window is.
  serverlessDatabaseCapacity: {
    threshold: 0,
    evaluationPeriods: 15,
    datapointsToAlarm: 10,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
