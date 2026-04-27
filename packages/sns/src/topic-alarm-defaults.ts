import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface TopicAlarmDefaults {
  enabled: true;
  numberOfNotificationsFailed: AlarmConfigDefaults;
  numberOfNotificationsFilteredOutInvalidAttributes: AlarmConfigDefaults;
  numberOfNotificationsRedrivenToDlq: AlarmConfigDefaults;
  numberOfNotificationsFailedToRedriveToDlq: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for SNS topics.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
 */
export const TOPIC_ALARM_DEFAULTS: TopicAlarmDefaults = {
  enabled: true,

  /** Any delivery failure is worth investigating; threshold 0. */
  numberOfNotificationsFailed: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any message filtered due to invalid attributes indicates a configuration issue; threshold 0. */
  numberOfNotificationsFilteredOutInvalidAttributes: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any redrive to a subscription DLQ indicates a delivery failure worth investigating; threshold 0. */
  numberOfNotificationsRedrivenToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any failure to redrive to a DLQ means message loss; threshold 0. */
  numberOfNotificationsFailedToRedriveToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
