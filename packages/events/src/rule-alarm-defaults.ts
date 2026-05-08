import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface RuleAlarmDefaults {
  enabled: true;
  failedInvocations: AlarmConfigDefaults;
  throttledRules: AlarmConfigDefaults;
  invocationsSentToDlq: AlarmConfigDefaults;
  invocationsFailedToBeSentToDlq: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for EventBridge rules.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EventBridge
 */
export const RULE_ALARM_DEFAULTS: RuleAlarmDefaults = {
  enabled: true,

  /** Any failure to deliver a matched event is worth investigating; threshold 0. */
  failedInvocations: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any throttling indicates a quota or downstream-concurrency problem; threshold 0. */
  throttledRules: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any redrive to a target DLQ indicates a delivery failure worth investigating; threshold 0. */
  invocationsSentToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any failure to redrive to a DLQ means event loss; threshold 0. */
  invocationsFailedToBeSentToDlq: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
