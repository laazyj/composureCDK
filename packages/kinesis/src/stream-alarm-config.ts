/**
 * Controls which recommended alarms are created for a Kinesis data stream.
 *
 * Set `enabled: false` (or pass `false` as `recommendedAlarms`) to disable the
 * recommended alarms; custom alarms added via `addAlarm()` are still created.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis
 */
export interface StreamAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;
}
