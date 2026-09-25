import { Duration } from "aws-cdk-lib";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmConfig, AlarmConfigDefaults, AlarmDefinition } from "@composurecdk/cloudwatch";
import { resolveAlarmConfig, greaterThanAlarmDefinition } from "@composurecdk/cloudwatch";

/**
 * Controls the recommended alarms for model invocation logging. Set an alarm
 * to `false` to disable it, or provide a config to tune it.
 *
 * The delivery metrics are account-wide for the Region, in the `AWS/Bedrock`
 * namespace with no dimensions.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html
 */
export interface ModelInvocationLoggingAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm when invocation logs fail to reach the log group.
   *
   * Metric: `ModelInvocationLogsCloudWatchDeliveryFailure`, statistic Sum.
   */
  cloudWatchDeliveryFailure?: AlarmConfig | false;

  /**
   * Alarm when large or binary bodies fail to reach the large-data bucket.
   * Created only when a large-data bucket is configured.
   *
   * Metric: `ModelInvocationLargeDataS3DeliveryFailure`, statistic Sum.
   */
  largeDataS3DeliveryFailure?: AlarmConfig | false;
}

type DeliveryAlarmKey = Exclude<keyof ModelInvocationLoggingAlarmConfig, "enabled">;

/** A failed delivery is an invocation missing from the audit record. */
const ANY_FAILURE: AlarmConfigDefaults = {
  threshold: 0,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/**
 * Default alarm configuration for model invocation logging. AWS publishes no
 * Bedrock thresholds.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp04.html
 */
export const MODEL_INVOCATION_LOGGING_ALARM_DEFAULTS: Record<
  DeliveryAlarmKey,
  AlarmConfigDefaults
> = {
  cloudWatchDeliveryFailure: ANY_FAILURE,
  largeDataS3DeliveryFailure: ANY_FAILURE,
};

const DELIVERY_ALARMS: Record<
  DeliveryAlarmKey,
  { metricName: string; destination: string; requiresBucket: boolean }
> = {
  cloudWatchDeliveryFailure: {
    metricName: "ModelInvocationLogsCloudWatchDeliveryFailure",
    destination: "the log group",
    requiresBucket: false,
  },
  largeDataS3DeliveryFailure: {
    metricName: "ModelInvocationLargeDataS3DeliveryFailure",
    destination: "the large-data bucket",
    requiresBucket: true,
  },
};

/** Resolves the recommended delivery-failure alarms. */
export function resolveModelInvocationLoggingAlarmDefinitions(
  config: ModelInvocationLoggingAlarmConfig | false | undefined,
  hasLargeDataBucket: boolean,
): AlarmDefinition[] {
  if (config === false || config?.enabled === false) return [];

  return (
    Object.entries(DELIVERY_ALARMS) as [
      DeliveryAlarmKey,
      (typeof DELIVERY_ALARMS)[DeliveryAlarmKey],
    ][]
  ).flatMap(([key, spec]) => {
    const userConfig = config?.[key];
    if (userConfig === false || (spec.requiresBucket && !hasLargeDataBucket)) return [];
    const cfg = resolveAlarmConfig(userConfig, MODEL_INVOCATION_LOGGING_ALARM_DEFAULTS[key]);
    const metric = new Metric({
      namespace: "AWS/Bedrock",
      metricName: spec.metricName,
      statistic: "Sum",
      period: Duration.minutes(1),
    });
    return [
      greaterThanAlarmDefinition(
        key,
        metric,
        cfg,
        `Bedrock model invocation logs are failing to reach ${spec.destination}; ` +
          `invocations are missing from the audit record. Threshold: > ${String(cfg.threshold)} per minute.`,
      ),
    ];
  });
}
