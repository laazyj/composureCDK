import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface BucketAlarmDefaults {
  enabled: true;
  serverErrors: AlarmConfigDefaults;
  clientErrors: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for S3 buckets.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3
 */
export const BUCKET_ALARM_DEFAULTS: BucketAlarmDefaults = {
  enabled: true,

  /** Any server-side error is worth investigating; threshold 0. */
  serverErrors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any client-side error pattern is worth investigating; threshold 0. */
  clientErrors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
