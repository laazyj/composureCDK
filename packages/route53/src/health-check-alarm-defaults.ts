import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface HealthCheckAlarmDefaults {
  enabled: true;
  healthCheckStatus: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for Route 53 health checks.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53
 */
export const HEALTH_CHECK_ALARM_DEFAULTS: HealthCheckAlarmDefaults = {
  enabled: true,

  /**
   * Alarm when `HealthCheckStatus < 1` for one consecutive 1-minute period.
   * The metric is 0 (unhealthy) or 1 (healthy) per Route 53 checker, so the
   * `Minimum` statistic surfaces "at least one checker reports unhealthy."
   *
   * `treatMissingData: breaching` matches AWS's recommendation — missing
   * datapoints are treated as unhealthy. This guards against situations
   * where the metric stops emitting (e.g. health check deletion) while the
   * downstream system still depends on it.
   */
  healthCheckStatus: {
    threshold: 1,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.BREACHING,
  },
};
