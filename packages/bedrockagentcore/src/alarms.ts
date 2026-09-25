import {
  ComparisonOperator,
  type Metric,
  type MetricOptions,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  type AlarmConfig,
  type AlarmConfigDefaults,
  type AlarmDefinition,
  type AlarmMetric,
  resolveAlarmConfig,
  type ResolvedAlarmConfig,
} from "@composurecdk/cloudwatch";

/**
 * > 0 in 3 of 5 minutes: SDK retries absorb isolated throttles and transient
 * errors, so a single datapoint is noise. No traffic emits no data.
 * @internal
 */
export const SUSTAINED: AlarmConfigDefaults = {
  threshold: 0,
  evaluationPeriods: 5,
  datapointsToAlarm: 3,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/** A greater-than alarm definition from a resolved config. @internal */
export function toDefinition(
  key: string,
  metric: AlarmMetric,
  cfg: ResolvedAlarmConfig,
  description: string,
): AlarmDefinition {
  return {
    key,
    alarmName: cfg.alarmName,
    metric,
    threshold: cfg.threshold,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: cfg.evaluationPeriods,
    datapointsToAlarm: cfg.datapointsToAlarm,
    treatMissingData: cfg.treatMissingData,
    description,
  };
}

/** A recommended alarm on one metric. @internal */
export interface ThresholdAlarmSpec {
  metricName: string;
  statistic: string;
  /** Absent for opt-in alarms, whose threshold the caller must supply. */
  defaults?: AlarmConfigDefaults;
  describe: (threshold: number) => string;
}

/** `AWS/Bedrock-AgentCore` metrics for one resource, on a 1-minute period. */
export interface AgentCoreMetricSource {
  metric(metricName: string, options?: MetricOptions): Metric;
}

/**
 * Controls the recommended alarms for an AgentCore runtime endpoint or
 * gateway. Set an alarm to `false` to disable it, or provide a config to
 * enable it (if opt-in) or tune it.
 *
 * Every alarm uses the `AWS/Bedrock-AgentCore` namespace and a 1-minute
 * period. AWS publishes no recommended AgentCore alarms; the Well-Architected
 * Agentic AI Lens asks for alarms on agent telemetry, and these thresholds are
 * this library's.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp02.html
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-service-provided.html
 */
export interface AgentCoreAlarmConfig {
  /**
   * Master switch: set to `false` to disable all recommended alarms.
   * @default true
   */
  enabled?: boolean;

  /**
   * Alarm on server-side errors.
   *
   * Metric: `SystemErrors`, statistic Sum. On by default: > 0 in 3 of 5 minutes.
   */
  systemErrors?: AlarmConfig | false;

  /**
   * Alarm on throttled requests, a sign the account's quota is exhausted.
   *
   * Metric: `Throttles`, statistic Sum. On by default: > 0 in 3 of 5 minutes.
   */
  throttles?: AlarmConfig | false;

  /**
   * Alarm on client errors. On by default for runtime endpoints, where an
   * exception in the agent's code is counted as a user error: > 0 in 3 of 5
   * minutes. Opt-in, with a threshold, for gateways.
   *
   * Metric: `UserErrors`, statistic Sum.
   */
  userErrors?: AlarmConfig | false;

  /**
   * Alarm on p90 latency, in milliseconds. Opt-in: there is no universal
   * baseline for how long an agent takes.
   *
   * Metric: `Latency`, statistic p90. Threshold required.
   */
  latency?: AlarmConfig | false;
}

type AgentCoreAlarmKey = Exclude<keyof AgentCoreAlarmConfig, "enabled">;

/**
 * Defaults for the on-by-default AgentCore alarms, shaped after AWS's
 * recommended Lambda `Errors` and `Throttles` alarms.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp02.html
 */
export const AGENTCORE_ALARM_DEFAULTS: Record<"systemErrors" | "throttles", AlarmConfigDefaults> = {
  systemErrors: SUSTAINED,
  throttles: SUSTAINED,
};

/** The recommended alarm specs for `subject`, e.g. `Runtime "support::DEFAULT"`. */
export function agentCoreAlarmSpecs(
  subject: string,
): Record<AgentCoreAlarmKey, ThresholdAlarmSpec> {
  return {
    systemErrors: {
      metricName: "SystemErrors",
      statistic: "Sum",
      defaults: AGENTCORE_ALARM_DEFAULTS.systemErrors,
      describe: (t) =>
        `${subject} is returning server errors. Threshold: > ${String(t)} per minute.`,
    },
    throttles: {
      metricName: "Throttles",
      statistic: "Sum",
      defaults: AGENTCORE_ALARM_DEFAULTS.throttles,
      describe: (t) =>
        `${subject} is throttling requests; review the account's AgentCore quotas. ` +
        `Threshold: > ${String(t)} per minute.`,
    },
    userErrors: {
      metricName: "UserErrors",
      statistic: "Sum",
      describe: (t) =>
        `${subject} is returning client errors. Threshold: > ${String(t)} per minute.`,
    },
    latency: {
      metricName: "Latency",
      statistic: "p90",
      describe: (t) => `p90 latency for ${subject} exceeds ${String(t)} ms.`,
    },
  };
}

/**
 * Defaults for a runtime endpoint's on-by-default alarms. User errors are
 * included because they count exceptions in the agent's own code.
 */
export const RUNTIME_ALARM_DEFAULTS: Record<
  "systemErrors" | "throttles" | "userErrors",
  AlarmConfigDefaults
> = { ...AGENTCORE_ALARM_DEFAULTS, userErrors: SUSTAINED };

/** {@link agentCoreAlarmSpecs} with user errors on by default. */
export function runtimeAlarmSpecs(subject: string): Record<AgentCoreAlarmKey, ThresholdAlarmSpec> {
  const specs = agentCoreAlarmSpecs(subject);
  return {
    ...specs,
    userErrors: { ...specs.userErrors, defaults: RUNTIME_ALARM_DEFAULTS.userErrors },
  };
}

/**
 * Resolves each spec against the caller's config: on-by-default alarms merge
 * over their defaults; opt-in alarms are created only when configured, and
 * need a threshold.
 */
export function resolveAgentCoreAlarms<K extends string>(
  source: AgentCoreMetricSource,
  specs: Record<K, ThresholdAlarmSpec>,
  config: (Partial<Record<K, AlarmConfig | false>> & { enabled?: boolean }) | false | undefined,
): AlarmDefinition[] {
  if (config === false || config?.enabled === false) return [];
  return (Object.keys(specs) as K[]).flatMap((key) => {
    const spec = specs[key];
    const userConfig = config?.[key];
    if (userConfig === false || (userConfig === undefined && !spec.defaults)) return [];
    if (!spec.defaults && userConfig?.threshold === undefined) {
      throw new Error(
        `The "${key}" alarm has no default threshold. Supply one, e.g. ` +
          `recommendedAlarms({ ${key}: { threshold: … } }).`,
      );
    }
    const cfg = resolveAlarmConfig(userConfig, spec.defaults ?? SUSTAINED);
    const metric = source.metric(spec.metricName, { statistic: spec.statistic });
    return [toDefinition(key, metric, cfg, spec.describe(cfg.threshold))];
  });
}
