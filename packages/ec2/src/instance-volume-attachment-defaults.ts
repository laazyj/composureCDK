import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface VolumeAttachmentAlarmDefaults {
  enabled: true;
  volumeStalledIo: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for per-attachment EBS
 * volumes.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EBS
 */
export const VOLUME_ATTACHMENT_ALARM_DEFAULTS: VolumeAttachmentAlarmDefaults = {
  enabled: true,

  /**
   * The single AWS-recommended EBS alarm. Complements the existing
   * `attachedEbsStatusCheckFailed` on the instance: the EC2-side metric
   * pages on instance-level reachability, this one on per-volume health.
   * The 10-of-10 evaluation window matches AWS guidance — EBS
   * infrastructure usually self-heals within a few minutes.
   */
  volumeStalledIo: {
    threshold: 1,
    evaluationPeriods: 10,
    datapointsToAlarm: 10,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
