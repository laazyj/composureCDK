import { Duration } from "aws-cdk-lib";
import { type Alarm, Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import type { Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import {
  type AlarmConfig,
  type AlarmDefinition,
  createAlarms,
  resolveAlarmConfig,
  resolveAlarmThresholdBasis,
} from "@composurecdk/cloudwatch";
import { SUSTAINED, toDefinition } from "./alarms.js";

/** The services that report `ActiveSessionCount`, by their `Service` dimension. */
const SERVICES = {
  runtime: "AgentCore.Runtime",
  browser: "AgentCore.Browser",
  codeInterpreter: "AgentCore.CodeInterpreter",
} as const;

type SessionService = keyof typeof SERVICES;

/** An alarm on active sessions above a fraction of the account's quota. */
export type QuotaAlarmConfig = Omit<AlarmConfig, "threshold"> & {
  /** The account's active-session quota, from Service Quotas. */
  quota: number;
  /** Threshold as a fraction of {@link quota}, in (0, 1]. */
  thresholdPercent?: number;
};

/** Opt-in alarms on each service's active sessions. */
export type SessionQuotaAlarmConfig = Partial<Record<SessionService, QuotaAlarmConfig | false>>;

/** Configuration properties for {@link createSessionQuotaAlarmBuilder}. */
export interface SessionQuotaAlarmBuilderProps {
  recommendedAlarms?: SessionQuotaAlarmConfig;
}

/** The build output of an {@link ISessionQuotaAlarmBuilder}. */
export interface SessionQuotaAlarmBuilderResult {
  /** The CloudWatch alarms created, keyed by service. */
  alarms: Partial<Record<SessionService, Alarm>>;
}

/** Defaults for {@link createSessionQuotaAlarmBuilder}. */
export const SESSION_QUOTA_ALARM_DEFAULTS = {
  /** Leaves 20% headroom to act before new sessions are refused. */
  thresholdPercent: 0.8,
};

/**
 * A fluent builder for alarms on AgentCore's account-wide session quotas.
 *
 * @see {@link createSessionQuotaAlarmBuilder}
 */
export type ISessionQuotaAlarmBuilder = ITaggedBuilder<
  SessionQuotaAlarmBuilderProps,
  SessionQuotaAlarmBuilder
>;

class SessionQuotaAlarmBuilder implements Lifecycle<SessionQuotaAlarmBuilderResult> {
  props: SessionQuotaAlarmBuilderProps = {};

  build(scope: IConstruct, id: string): SessionQuotaAlarmBuilderResult {
    const definitions = (Object.keys(SERVICES) as SessionService[]).flatMap((service) =>
      quotaAlarm(scope, service, this.props.recommendedAlarms?.[service]),
    );
    return { alarms: createAlarms(scope, id, definitions) };
  }
}

function quotaAlarm(
  scope: IConstruct,
  service: SessionService,
  config: QuotaAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (!config) return [];
  const quota = resolveAlarmThresholdBasis({
    scope,
    value: config.quota,
    resolve: (q) => q,
    warningId: "@composurecdk/bedrockagentcore:session-quota-alarm",
    alarmLabel: `${SERVICES[service]} session quota`,
    suppressHint: `recommendedAlarms({ ${service}: false })`,
  });
  if (quota === undefined) return [];
  const percent = config.thresholdPercent ?? SESSION_QUOTA_ALARM_DEFAULTS.thresholdPercent;
  if (!(quota > 0)) {
    throw new Error(`${service}: quota must be a positive number, got ${String(quota)}.`);
  }
  if (!(percent > 0 && percent <= 1)) {
    throw new Error(`${service}: thresholdPercent must be in (0, 1], got ${String(percent)}.`);
  }
  const metric = new Metric({
    namespace: "AWS/Bedrock-AgentCore",
    metricName: "ActiveSessionCount",
    dimensionsMap: { Service: SERVICES[service] },
    statistic: "Maximum",
    period: Duration.minutes(1),
  });
  const cfg = resolveAlarmConfig({ ...config, threshold: Math.floor(quota * percent) }, SUSTAINED);
  const description =
    `Active ${SERVICES[service]} sessions exceed ${String(percent * 100)}% of the ` +
    `${String(quota)}-session quota.`;
  return [toDefinition(service, metric, cfg, description)];
}

/**
 * Creates a builder for alarms on AgentCore's active-session quotas.
 * `ActiveSessionCount` covers the whole account and Region, so build one per
 * account and Region. Each alarm needs the quota from Service Quotas.
 *
 * @example
 * ```ts
 * createSessionQuotaAlarmBuilder().recommendedAlarms({ runtime: { quota: 2500 } });
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-runtime-metrics.html
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html
 */
export function createSessionQuotaAlarmBuilder(): ISessionQuotaAlarmBuilder {
  return taggedBuilder<SessionQuotaAlarmBuilderProps, SessionQuotaAlarmBuilder>(
    SessionQuotaAlarmBuilder,
  );
}
