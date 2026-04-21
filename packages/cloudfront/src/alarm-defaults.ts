import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig } from "@composurecdk/cloudwatch";

interface DistributionAlarmDefaults {
  enabled: true;
  errorRate: Required<AlarmConfig>;
  originLatency: Required<AlarmConfig>;
}

interface FunctionAlarmDefaults {
  enabled: true;
  executionErrors: Required<AlarmConfig>;
  validationErrors: Required<AlarmConfig>;
  throttles: Required<AlarmConfig>;
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

/**
 * Default alarm configuration for CloudFront Functions declared inline on
 * a cache behavior. Any non-zero count of errors or throttles is worth
 * investigating since a function executes on every viewer request/response.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/monitoring-functions.html
 */
export const FUNCTION_ALARM_DEFAULTS: FunctionAlarmDefaults = {
  enabled: true,

  /** Any execution error indicates a runtime fault on the edge; threshold 0. */
  executionErrors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any validation error indicates the function returned a bad event; threshold 0. */
  validationErrors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /** Any throttle indicates the function exceeded its 1ms compute budget; threshold 0. */
  throttles: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
