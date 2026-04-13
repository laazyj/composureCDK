import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "@composurecdk/cloudwatch";

interface SubscriptionAlarmDefaults {
  enabled: true;
  numberOfNotificationsRedrivenToDlq: Required<AlarmConfig>;
  numberOfNotificationsFailedToRedriveToDlq: Required<AlarmConfig>;
}

/**
 * AWS-recommended default alarm configuration for SNS subscriptions with a
 * dead-letter queue.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export const SUBSCRIPTION_ALARM_DEFAULTS: SubscriptionAlarmDefaults = {
  enabled: true,

  /** Any redrive to the DLQ indicates a delivery failure worth investigating; threshold 0. */
  numberOfNotificationsRedrivenToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any failure to redrive to the DLQ means message loss; threshold 0. */
  numberOfNotificationsFailedToRedriveToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
