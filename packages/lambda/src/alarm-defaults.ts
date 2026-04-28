import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import type { PercentageAlarmConfigDefaults } from "./alarm-config.js";

interface FunctionAlarmDefaults {
  enabled: true;
  errors: AlarmConfigDefaults;
  throttles: AlarmConfigDefaults;
  duration: PercentageAlarmConfigDefaults;
  concurrentExecutions: PercentageAlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for Lambda functions.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda
 */
export const FUNCTION_ALARM_DEFAULTS: FunctionAlarmDefaults = {
  enabled: true,

  /** Any error is worth investigating; threshold 0. */
  errors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any throttle indicates capacity pressure; threshold 0. */
  throttles: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * p99 duration approaching timeout indicates risk of timeouts.
   * 90% of the configured timeout — early warning before hard failures.
   */
  duration: {
    thresholdPercent: 0.9,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Concurrent executions approaching reserved concurrency indicates
   * risk of throttling. 80% of the reserved limit — early warning.
   */
  concurrentExecutions: {
    thresholdPercent: 0.8,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
