import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for an activity. Each is on
 * by default; set one to `false` to disable it, or pass an {@link AlarmConfig}
 * to tune it.
 *
 * AWS publishes no thresholds; see the package README for the rationale.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-metrics-and-alerts.html
 */
export interface ActivityAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /** Alarm when a worker reports a task failed. Metric: `AWS/States ActivitiesFailed`. */
  activitiesFailed?: AlarmConfig | false;

  /**
   * Alarm when a task times out before a worker completes it — often no worker
   * is polling. Metric: `AWS/States ActivitiesTimedOut`.
   */
  activitiesTimedOut?: AlarmConfig | false;

  /**
   * Alarm when a worker stops sending heartbeats for a task it took — usually
   * a worker that crashed mid-task. Metric: `AWS/States ActivitiesHeartbeatTimedOut`.
   */
  activitiesHeartbeatTimedOut?: AlarmConfig | false;
}
