import type { AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { SUSTAINED } from "./alarm-definition.js";

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
  invocationThrottles: { threshold: 0, ...SUSTAINED },
  invocationServerErrors: { threshold: 0, ...SUSTAINED },
  invocationClientErrors: { threshold: 0, ...SUSTAINED },
  optIn: SUSTAINED,
  /** Leaves 20% headroom to act before requests are throttled. */
  estimatedTpmQuotaUsage: { thresholdPercent: 0.8 },
};
