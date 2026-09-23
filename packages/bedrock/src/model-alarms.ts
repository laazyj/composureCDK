import { Duration } from "aws-cdk-lib";
import type { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { Metric, type MetricOptions } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { resolveAlarmConfig, resolveAlarmThresholdBasis } from "@composurecdk/cloudwatch";
import {
  resolveThresholdAlarms,
  type ThresholdAlarmSpec,
  toDefinition,
} from "./alarm-definition.js";
import type { InferenceProfile } from "./inference-profile.js";
import { isInferenceProfile } from "./inference-target.js";
import type { ModelAlarmConfig } from "./model-alarm-config.js";
import { MODEL_ALARM_DEFAULTS } from "./model-alarm-defaults.js";

/** A model whose `AWS/Bedrock` metrics an alarm can read. */
export type ModelAlarmTarget = FoundationModelIdentifier | InferenceProfile;

/** `AWS/Bedrock` metrics for one model, for alarms added with `addAlarm()`. */
export interface ModelMetrics {
  /** The `ModelId` dimension value: the model or inference profile id invoked. */
  readonly modelId: string;
  /** An `AWS/Bedrock` metric dimensioned by {@link modelId}. */
  metric(metricName: string, options?: MetricOptions): Metric;
}

const PERIOD = Duration.minutes(1);

/** Returns the `AWS/Bedrock` metrics for `target`. */
export function modelMetrics(target: ModelAlarmTarget): ModelMetrics {
  const modelId = isInferenceProfile(target) ? target.profileId : target.modelId;
  return {
    modelId,
    metric: (metricName, options) =>
      new Metric({
        namespace: "AWS/Bedrock",
        metricName,
        dimensionsMap: { ModelId: modelId },
        period: PERIOD,
        ...options,
      }),
  };
}

type ThresholdAlarmKey = Exclude<keyof ModelAlarmConfig, "enabled" | "estimatedTpmQuotaUsage">;

function thresholdAlarms(modelId: string): Record<ThresholdAlarmKey, ThresholdAlarmSpec> {
  return {
    invocationThrottles: {
      metricName: "InvocationThrottles",
      statistic: "Sum",
      defaults: MODEL_ALARM_DEFAULTS.invocationThrottles,
      describe: (t) =>
        `Bedrock is throttling requests to ${modelId}; the account's quota for the model is ` +
        `exhausted. Threshold: > ${String(t)} per minute.`,
    },
    invocationServerErrors: {
      metricName: "InvocationServerErrors",
      statistic: "Sum",
      defaults: MODEL_ALARM_DEFAULTS.invocationServerErrors,
      describe: (t) =>
        `Bedrock is returning server errors for ${modelId}. Threshold: > ${String(t)} per minute.`,
    },
    invocationClientErrors: {
      metricName: "InvocationClientErrors",
      statistic: "Sum",
      defaults: MODEL_ALARM_DEFAULTS.invocationClientErrors,
      describe: (t) =>
        `Requests to ${modelId} are failing with client errors, such as AccessDenied or ` +
        `validation errors. Threshold: > ${String(t)} per minute.`,
    },
    invocationLatency: {
      metricName: "InvocationLatency",
      statistic: "p90",
      describe: (t) => `p90 invocation latency for ${modelId} exceeds ${String(t)} ms.`,
    },
    timeToFirstToken: {
      metricName: "TimeToFirstToken",
      statistic: "p90",
      describe: (t) => `p90 time to first token for ${modelId} exceeds ${String(t)} ms.`,
    },
  };
}

function quotaAlarm(
  scope: IConstruct,
  metrics: ModelMetrics,
  config: ModelAlarmConfig["estimatedTpmQuotaUsage"],
): AlarmDefinition[] {
  if (!config) return [];
  const quota = resolveAlarmThresholdBasis({
    scope,
    value: config.quota,
    resolve: (q) => q,
    warningId: "@composurecdk/bedrock:token-tpm-quota-alarm",
    alarmLabel: "Bedrock estimated TPM quota usage",
    suppressHint: "recommendedAlarms({ estimatedTpmQuotaUsage: false })",
  });
  if (quota === undefined) return [];
  const percent =
    config.thresholdPercent ?? MODEL_ALARM_DEFAULTS.estimatedTpmQuotaUsage.thresholdPercent;
  if (!(quota > 0)) {
    throw new Error(
      `estimatedTpmQuotaUsage: quota must be a positive number, got ${String(quota)}.`,
    );
  }
  if (!(percent > 0 && percent <= 1)) {
    throw new Error(
      `estimatedTpmQuotaUsage: thresholdPercent must be in (0, 1], got ${String(percent)}.`,
    );
  }
  const cfg = resolveAlarmConfig(
    { ...config, threshold: Math.floor(quota * percent) },
    { ...MODEL_ALARM_DEFAULTS.optIn, threshold: 0 },
  );
  return [
    toDefinition(
      "estimatedTpmQuotaUsage",
      metrics.metric("EstimatedTPMQuotaUsage", { statistic: "Maximum" }),
      cfg,
      `Estimated token usage for ${metrics.modelId} exceeds ${String(percent * 100)}% of the ` +
        `${String(quota)} tokens-per-minute quota.`,
    ),
  ];
}

/** Resolves the recommended alarm configuration for a model's metrics. */
export function resolveModelAlarmDefinitions(
  scope: IConstruct,
  metrics: ModelMetrics,
  config: ModelAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions = resolveThresholdAlarms(
    thresholdAlarms(metrics.modelId),
    config,
    (metricName, statistic) => metrics.metric(metricName, { statistic }),
  );

  return [...definitions, ...quotaAlarm(scope, metrics, config?.estimatedTpmQuotaUsage)];
}
