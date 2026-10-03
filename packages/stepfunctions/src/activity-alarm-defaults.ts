import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { ANY_OCCURRENCE } from "./alarm-defaults.js";

interface ActivityAlarmDefaults {
  enabled: true;
  activitiesFailed: AlarmConfigDefaults;
  activitiesTimedOut: AlarmConfigDefaults;
  activitiesHeartbeatTimedOut: AlarmConfigDefaults;
}

/**
 * Default alarm configuration for activities — see {@link ActivityAlarmConfig}.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-metrics-and-alerts.html
 */
export const ACTIVITY_ALARM_DEFAULTS: ActivityAlarmDefaults = {
  enabled: true,
  activitiesFailed: ANY_OCCURRENCE,
  activitiesTimedOut: ANY_OCCURRENCE,
  activitiesHeartbeatTimedOut: ANY_OCCURRENCE,
};
