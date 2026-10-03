import {
  LogLevel,
  type LogOptions,
  type StateMachineProps,
  StateMachineType,
} from "aws-cdk-lib/aws-stepfunctions";

/**
 * Secure, AWS-recommended defaults applied to every state machine built with
 * {@link createStateMachineBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const STATE_MACHINE_DEFAULTS: Partial<StateMachineProps> = {
  /**
   * Enable AWS X-Ray tracing, so a request is followed from its caller through
   * every state and into the services the tasks call.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html
   */
  tracingEnabled: true,
};

/**
 * Execution-history logging defaults, by workflow type. The builder merges the
 * caller's `logs` over the entry for the state machine's type.
 *
 * Logging is on for every type: CDK's default is none, and Security Hub
 * control StepFunctions.1 requires it. Execution data — the input and output of
 * every state — is left out, because it is the workload's own data and may be
 * sensitive; opt in with `includeExecutionData: true`.
 *
 * @see https://docs.aws.amazon.com/securityhub/latest/userguide/stepfunctions-controls.html#stepfunctions-1
 * @see https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_detect_investigate_events_app_service_logging.html
 * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/data-protection.html
 */
export const STATE_MACHINE_LOG_DEFAULTS: Record<
  StateMachineType,
  Omit<LogOptions, "destination">
> = {
  /**
   * `ERROR` — Standard workflows keep their full execution history in Step
   * Functions for 90 days, so the logs need only carry the failures, aborts
   * and timeouts an operator alarms and searches on.
   * @see https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html
   */
  [StateMachineType.STANDARD]: { level: LogLevel.ERROR, includeExecutionData: false },

  /**
   * `ALL` — an Express workflow has no execution history except what it logs,
   * so anything less leaves a successful execution with no record at all.
   * @see https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html
   */
  [StateMachineType.EXPRESS]: { level: LogLevel.ALL, includeExecutionData: false },
};
