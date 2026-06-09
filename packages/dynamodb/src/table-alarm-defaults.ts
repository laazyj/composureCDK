import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";

interface TableAlarmDefaults {
  enabled: true;
  systemErrors: AlarmConfigDefaults;
  readThrottleEvents: AlarmConfigDefaults;
  writeThrottleEvents: AlarmConfigDefaults;
}

/**
 * AWS-recommended default alarm configuration for DynamoDB tables.
 *
 * Thresholds are deliberately strict (> 0) because the metrics they watch —
 * server-side errors and throttling — should be at or near zero for a healthy
 * table. Tune them up via `recommendedAlarms` for workloads where a low rate
 * of throttling is expected and acceptable (e.g. cost-optimised provisioned
 * tables that lean on burst capacity).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB
 */
export const TABLE_ALARM_DEFAULTS: TableAlarmDefaults = {
  enabled: true,

  /**
   * > 0 — any server-side (HTTP 500) error is an availability signal worth
   * investigating. NOT_BREACHING for missing data: a table with no traffic
   * emits no SystemErrors datapoints and should stay OK.
   */
  systemErrors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * > 0 — surface read throttling immediately. Conservative starting point;
   * raise the threshold or `evaluationPeriods` for workloads where brief,
   * self-correcting throttling under burst is tolerable.
   */
  readThrottleEvents: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },

  /**
   * > 0 — surface write throttling immediately, on the same basis as read
   * throttling.
   */
  writeThrottleEvents: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
};
