import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * The `openExecutions` alarm. Its threshold is a fraction of the account's
 * open-execution quota, which the alarm reads from `OpenExecutionLimit`, so it
 * follows a raised quota without changes.
 */
export type OpenExecutionsAlarmConfig = Omit<AlarmConfig, "threshold"> & {
  /**
   * Threshold as a fraction of the account's open-execution quota, in (0, 1].
   * @default 0.1
   */
  thresholdPercent?: number;
};

/**
 * Controls which account-level alarms are created. Set an alarm to `false` to
 * disable it, or provide a config to enable it (if opt-in) or tune it.
 *
 * Every metric is in the `AWS/States` namespace, has no dimensions and covers
 * the whole account in one Region, over a 1-minute period. Step Functions
 * delivers these metrics on a best-effort basis, so missing data is treated
 * as not breaching.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html
 */
export interface AccountAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when open Standard executions near the account's quota (1,000,000
   * by default, and raisable). At the quota, `StartExecution` and
   * `RedriveExecution` fail with `ExecutionLimitExceeded`. Express executions
   * do not count toward it.
   *
   * Metric: `OpenExecutionCount / OpenExecutionLimit`, statistic Maximum. On
   * by default, above 0.1 of the quota. AWS recommends a threshold of 100K or
   * more against the 1M default, which is the same 0.1 ratio. Below about
   * 10,000 open executions, `OpenExecutionCount` can read zero.
   */
  openExecutions?: OpenExecutionsAlarmConfig | false;

  /**
   * Alarm when open Distributed Map Runs near the hard quota of 1,000. Past
   * it, new Map Runs wait in a backlog.
   *
   * Metric: `ApproximateOpenMapRunCount`, statistic Maximum. On by default,
   * above 900, the threshold AWS recommends.
   */
  openMapRuns?: AlarmConfig | false;

  /**
   * Alarm when Map Runs are waiting in the backlog for open Map Runs to drop
   * below the quota. A backlog can be expected during bursts, so there is no
   * default threshold.
   *
   * Metric: `ApproximateMapRunBacklogSize`, statistic Maximum. Opt-in; a
   * threshold is required.
   */
  mapRunBacklog?: AlarmConfig | false;

  /**
   * Alarm when `StartExecution` calls are throttled by the account's API
   * token bucket.
   *
   * Metric: `ThrottledEvents` with `APIName=StartExecution`, statistic Sum.
   * Opt-in; once enabled the default threshold is > 0.
   */
  startExecutionThrottled?: AlarmConfig | false;

  /**
   * Alarm when state transitions are throttled across the account. Standard
   * workflows only. Each state machine's `executionThrottled` alarm already
   * covers this per machine.
   *
   * Metric: `ThrottledEvents` with `ServiceMetric=StateTransition`, statistic
   * Sum. Opt-in; once enabled the default threshold is > 0.
   */
  stateTransitionThrottled?: AlarmConfig | false;
}
