import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface RestApiAlarmDefaults {
  enabled: true;
  clientError: AlarmConfigDefaults;
  serverError: AlarmConfigDefaults;
  latency: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for API Gateway REST APIs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway
 */
export const REST_API_ALARM_DEFAULTS: RestApiAlarmDefaults = {
  enabled: true,

  /**
   * Elevated 4XX error rate indicates client-side issues such as
   * authorization failures, invalid parameters, or throttling.
   * Threshold 0.05 = 5% of requests.
   */
  clientError: {
    threshold: 0.05,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Elevated 5XX error rate indicates server-side issues such as
   * backend failures or integration errors.
   * Threshold 0.05 = 5% of requests.
   */
  serverError: {
    threshold: 0.05,
    evaluationPeriods: 3,
    datapointsToAlarm: 3,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * Elevated p90 latency indicates slow API responses that may
   * impact user experience or trigger downstream timeouts.
   * Default 2500ms threshold per AWS recommendation.
   */
  latency: {
    threshold: 2500,
    evaluationPeriods: 5,
    datapointsToAlarm: 5,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
