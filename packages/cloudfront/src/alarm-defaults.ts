import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "@composurecdk/cloudwatch";

interface DistributionAlarmDefaults {
  enabled: true;
  errorRate: Required<AlarmConfig>;
  originLatency: Required<AlarmConfig>;
}

/**
 * AWS-recommended default alarm configuration for CloudFront distributions.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront
 */
export const DISTRIBUTION_ALARM_DEFAULTS: DistributionAlarmDefaults = {
  enabled: true,

  /**
   * Elevated 5xx error rate indicates origin or CloudFront issues.
   * Threshold set above 0 to avoid excessive sensitivity from transient errors.
   */
  errorRate: {
    threshold: 5,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Origin taking too long to respond can lead to 504 errors.
   * Default 5000ms threshold provides a reasonable starting point;
   * ideally set to ~80% of your origin response timeout.
   */
  originLatency: {
    threshold: 5000,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
