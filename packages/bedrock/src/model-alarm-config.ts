import type { AlarmConfig, QuotaAlarmConfig } from "@composurecdk/cloudwatch";

/**
 * Controls which recommended alarms are created for a model. Set an alarm to
 * `false` to disable it, or provide a config to enable it (if opt-in) or tune
 * it.
 *
 * Every alarm uses the `AWS/Bedrock` namespace, the `ModelId` dimension and a
 * 1-minute period. Bedrock metrics aggregate every caller of the model in the
 * account and Region.
 *
 * AWS publishes no recommended thresholds for Bedrock. The Well-Architected
 * Generative AI Lens names which signals to alarm on; the thresholds are this
 * library's.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp02.html
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html
 */
export interface ModelAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when requests are throttled. Throttled requests are not counted in
   * `Invocations`, and SDK retries mean a count here was already retried.
   *
   * Metric: `InvocationThrottles`, statistic Sum. On by default.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp03.html
   */
  invocationThrottles?: AlarmConfig | false;

  /**
   * Alarm on server-side (5xx) invocation errors.
   *
   * Metric: `InvocationServerErrors`, statistic Sum. On by default.
   */
  invocationServerErrors?: AlarmConfig | false;

  /**
   * Alarm on client-side (4xx) invocation errors, including `AccessDenied`
   * from a Region missing from a cross-Region grant and validation errors
   * such as a prompt over the context window.
   *
   * Metric: `InvocationClientErrors`, statistic Sum. On by default.
   */
  invocationClientErrors?: AlarmConfig | false;

  /**
   * Alarm when invocation latency, in milliseconds to the last token, exceeds
   * the threshold. Latency depends on the model and output length, so there
   * is no default threshold.
   *
   * Metric: `InvocationLatency`, statistic p90. Opt-in; threshold required.
   */
  invocationLatency?: AlarmConfig | false;

  /**
   * Alarm when time to first token, in milliseconds, exceeds the threshold.
   * Emitted for streaming APIs only.
   *
   * Metric: `TimeToFirstToken`, statistic p90. Opt-in; threshold required.
   */
  timeToFirstToken?: AlarmConfig | false;

  /**
   * Alarm when estimated tokens-per-minute usage approaches the applied
   * quota. AWS advises against relying on this metric alone for quota use.
   *
   * Metric: `EstimatedTPMQuotaUsage`, statistic Maximum. Opt-in; `quota`
   * required.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genrel01-bp01.html
   */
  estimatedTpmQuotaUsage?: QuotaAlarmConfig | false;
}
