import { Duration } from "aws-cdk-lib";
import type { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { Metric, type MetricOptions } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import {
  resolveQuotaAlarm,
  resolveThresholdAlarms,
  type ThresholdAlarmSpec,
} from "@composurecdk/cloudwatch";
import type { ApplicationInferenceProfile, InferenceProfile } from "./inference-profile.js";
import type { ModelAlarmConfig } from "./model-alarm-config.js";
import { MODEL_ALARM_DEFAULTS } from "./model-alarm-defaults.js";

/** A model whose `AWS/Bedrock` metrics an alarm can read. */
export type ModelAlarmTarget =
  FoundationModelIdentifier | InferenceProfile | ApplicationInferenceProfile;

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
  const modelId = "profileId" in target ? target.profileId : target.modelId;
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

  return [
    ...definitions,
    ...resolveQuotaAlarm({
      scope,
      key: "estimatedTpmQuotaUsage",
      config: config?.estimatedTpmQuotaUsage,
      metric: () => metrics.metric("EstimatedTPMQuotaUsage", { statistic: "Maximum" }),
      defaultThresholdPercent: MODEL_ALARM_DEFAULTS.estimatedTpmQuotaUsage.thresholdPercent,
      warningId: "@composurecdk/bedrock:token-tpm-quota-alarm",
      alarmLabel: "Bedrock estimated TPM quota usage",
      describe: (quota, percent) =>
        `Estimated token usage for ${metrics.modelId} exceeds ${String(percent * 100)}% of the ` +
        `${String(quota)} tokens-per-minute quota.`,
    }),
  ];
}
