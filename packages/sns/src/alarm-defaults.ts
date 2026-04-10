import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "@composurecdk/cloudwatch";

interface TopicAlarmDefaults {
  enabled: true;
  numberOfNotificationsFailed: Required<AlarmConfig>;
  numberOfNotificationsFilteredOutInvalidAttributes: Required<AlarmConfig>;
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
};
