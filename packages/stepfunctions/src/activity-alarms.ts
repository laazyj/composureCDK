import type { Activity } from "aws-cdk-lib/aws-stepfunctions";
import type { ActivityAlarmConfig } from "./activity-alarm-config.js";
import { ACTIVITY_ALARM_DEFAULTS } from "./activity-alarm-defaults.js";
import type { AlarmSet } from "./alarm-specs.js";

/** An activity's recommended alarms, keyed so a config field without a spec is a type error. */
export const ACTIVITY_ALARMS: AlarmSet<Activity, Exclude<keyof ActivityAlarmConfig, "enabled">> = {
  defaults: ACTIVITY_ALARM_DEFAULTS,
  specs: {
    activitiesFailed: {
      metric: (activity, options) => activity.metricFailed(options),
      describe: "Activity workers are reporting failed tasks.",
    },
    activitiesTimedOut: {
      metric: (activity, options) => activity.metricTimedOut(options),
      describe: "Activity tasks are timing out before a worker completes them.",
    },
    activitiesHeartbeatTimedOut: {
      metric: (activity, options) => activity.metricHeartbeatTimedOut(options),
      describe: "Activity workers have stopped sending heartbeats for tasks they took.",
    },
  },
};
