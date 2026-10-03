import type { AlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a state machine. Each is
 * on by default; set one to `false` to disable it, or pass an
 * {@link AlarmConfig} to tune it.
 *
 * AWS publishes no recommended alarms for Step Functions. The metrics are the
 * ones the Serverless Lens names for aggregate-level alarms; the thresholds
 * are this library's choice, shaped like Lambda's `errors` and `throttles`.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-metrics-and-alerts.html
 */
export interface StateMachineAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when executions fail.
   *
   * Metric: `AWS/States ExecutionsFailed`, statistic Sum, period 1 minute.
   * Default threshold: > 0. Model an expected outcome — a rejected order —
   * as a `Catch` that succeeds, and keep `Fail` for faults, or this pages on
   * business as usual.
   */
  executionsFailed?: AlarmConfig | false;

  /**
   * Alarm when executions exceed their timeout — the state machine's own, or
   * Express's five-minute cap.
   *
   * Metric: `AWS/States ExecutionsTimedOut`, statistic Sum, period 1 minute.
   * Default threshold: > 0.
   */
  executionsTimedOut?: AlarmConfig | false;

  /**
   * Alarm when state transitions are throttled — the signal AWS gives for
   * requesting a Standard workflow quota increase.
   *
   * Only created for a **Standard** state machine: Express state transitions
   * are not throttled.
   *
   * Metric: `AWS/States ExecutionThrottled`, statistic Sum, period 1 minute.
   * Default threshold: > 0. Emitted only when throttling occurs, so missing
   * data is not breaching.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/aws-step-functions-2.html
   */
  executionThrottled?: AlarmConfig | false;
}
