import { type AlarmConfigDefaults, SUSTAINED_ALARM_DEFAULTS } from "@composurecdk/cloudwatch";

interface ModelAlarmDefaults {
  enabled: true;
  invocationThrottles: AlarmConfigDefaults;
  invocationServerErrors: AlarmConfigDefaults;
  invocationClientErrors: AlarmConfigDefaults;
  /** Applied to the opt-in alarms; their threshold comes from the caller. */
  optIn: Omit<AlarmConfigDefaults, "threshold">;
  estimatedTpmQuotaUsage: { thresholdPercent: number };
}

/**
 * Default alarm configuration for a Bedrock model. AWS publishes no Bedrock
 * thresholds; these follow the shape of AWS's recommended Lambda `Errors` and
 * `Throttles` alarms.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp02.html
 */
export const MODEL_ALARM_DEFAULTS: ModelAlarmDefaults = {
  enabled: true,
  invocationThrottles: { threshold: 0, ...SUSTAINED_ALARM_DEFAULTS },
  invocationServerErrors: { threshold: 0, ...SUSTAINED_ALARM_DEFAULTS },
  invocationClientErrors: { threshold: 0, ...SUSTAINED_ALARM_DEFAULTS },
  optIn: SUSTAINED_ALARM_DEFAULTS,
  /** Leaves 20% headroom to act before requests are throttled. */
  estimatedTpmQuotaUsage: { thresholdPercent: 0.8 },
};
