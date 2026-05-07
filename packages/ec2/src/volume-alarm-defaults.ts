import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface VolumeAlarmDefaults {
  enabled: true;
  burstBalance: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for EBS volumes.
 *
 * Thresholds are sourced from the CloudWatch Best Practice Recommended
 * Alarms guide. Thresholds may reasonably be tuned per-workload; defaults
 * bias toward catching obvious issues without excessive noise.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
 */
export const VOLUME_ALARM_DEFAULTS: VolumeAlarmDefaults = {
  enabled: true,

  /**
   * Burst credit balance is a percentage. Below 20% the volume is
   * approaching throttling to baseline performance — early warning to
   * upsize, switch to a non-burstable type (e.g. `gp3`), or investigate
   * unexpectedly heavy I/O. The 3-of-3 evaluation at 5-minute granularity
   * suppresses transient dips around backup windows.
   */
  burstBalance: {
    threshold: 20,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
