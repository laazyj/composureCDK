import { Duration } from "aws-cdk-lib";
import { Metric, type MetricOptions } from "aws-cdk-lib/aws-cloudwatch";
import {
  type AlarmConfig,
  type AlarmDefinition,
  resolveThresholdAlarms,
  type ThresholdAlarmSpec,
} from "@composurecdk/cloudwatch";
import type { GuardrailReference } from "./guardrail-builder.js";

/** `AWS/Bedrock/Guardrails` metrics for one guardrail version. */
export interface GuardrailMetrics {
  /** A metric dimensioned by the guardrail's ARN and version. */
  metric(metricName: string, options?: MetricOptions): Metric;
}

/** Returns the `AWS/Bedrock/Guardrails` metrics for `guardrail`. */
export function guardrailMetrics(guardrail: GuardrailReference): GuardrailMetrics {
  return {
    metric: (metricName, options) =>
      new Metric({
        namespace: "AWS/Bedrock/Guardrails",
        metricName,
        dimensionsMap: {
          GuardrailArn: guardrail.guardrailArn,
          GuardrailVersion: guardrail.version,
        },
        period: Duration.minutes(1),
        ...options,
      }),
  };
}

/**
 * Controls the recommended alarms for a guardrail. Both are opt-in and need a
 * threshold: what counts as normal depends on the workload.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-guardrails-cw-metrics.html
 */
export interface GuardrailAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when the guardrail intervenes more often than the threshold, e.g.
   * a spike in prompt attacks or a filter set too strictly.
   *
   * Metric: `InvocationsIntervened`, statistic Sum. Opt-in; threshold required.
   */
  invocationsIntervened?: AlarmConfig | false;

  /**
   * Alarm when evaluating the guardrail takes longer than the threshold, in
   * milliseconds.
   *
   * Metric: `InvocationLatency`, statistic p90. Opt-in; threshold required.
   */
  invocationLatency?: AlarmConfig | false;
}

const GUARDRAIL_ALARMS: Record<
  Exclude<keyof GuardrailAlarmConfig, "enabled">,
  ThresholdAlarmSpec
> = {
  invocationsIntervened: {
    metricName: "InvocationsIntervened",
    statistic: "Sum",
    describe: (t) => `The guardrail is intervening more than ${String(t)} times a minute.`,
  },
  invocationLatency: {
    metricName: "InvocationLatency",
    statistic: "p90",
    describe: (t) => `p90 guardrail evaluation latency exceeds ${String(t)} ms.`,
  },
};

/** Resolves the recommended guardrail alarms. */
export function resolveGuardrailAlarmDefinitions(
  metrics: GuardrailMetrics,
  config: GuardrailAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (config === false || config?.enabled === false) return [];
  return resolveThresholdAlarms(GUARDRAIL_ALARMS, config, (metricName, statistic) =>
    metrics.metric(metricName, { statistic }),
  );
}
