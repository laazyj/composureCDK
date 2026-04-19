import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "@composurecdk/cloudwatch";

interface InstanceAlarmDefaults {
  enabled: true;
  cpuUtilization: Required<AlarmConfig>;
  statusCheckFailed: Required<AlarmConfig>;
  cpuCreditBalance: Required<AlarmConfig>;
}

/**
 * AWS-recommended default alarm configuration for EC2 instances.
 *
 * Thresholds are sourced from the CloudWatch Best Practice Recommended
 * Alarms guide. Thresholds may reasonably be tuned per-workload; defaults
 * bias toward catching obvious issues without excessive noise.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
 */
export const INSTANCE_ALARM_DEFAULTS: InstanceAlarmDefaults = {
  enabled: true,

  /**
   * Sustained high CPU indicates the instance is a bottleneck and may
   * need to be scaled up. 80% over 5 consecutive minutes avoids
   * alarming on brief workload spikes.
   */
  cpuUtilization: {
    threshold: 80,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Any status check failure is actionable — it indicates instance or
   * host impairment. 2-of-2 evaluation filters transient single-minute
   * noise while keeping time-to-detect low.
   */
  statusCheckFailed: {
    threshold: 0,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Low CPU credit balance on burstable instances means imminent
   * throttling to baseline performance. Threshold < 50 at 5-minute
   * minimum gives an early warning to investigate or switch instance
   * family. Credit balance metrics are only emitted at 5-minute
   * granularity regardless of detailed monitoring.
   */
  cpuCreditBalance: {
    threshold: 50,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
