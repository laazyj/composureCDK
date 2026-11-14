import { Token } from "aws-cdk-lib";
import { ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import {
  type AlarmConfig,
  type AlarmConfigDefaults,
  type AlarmDefinition,
  type AlarmMetric,
  resolveAlarmConfig,
} from "@composurecdk/cloudwatch";
import type { WebAclAlarmConfig } from "./alarm-config.js";
import { WEB_ACL_RULE_ALARM_DEFAULTS } from "./alarm-defaults.js";
import {
  type ManagedRuleGroupVersion,
  REQUEST_METRIC_PERIOD,
  type WebAclMetrics,
} from "./metrics.js";
import type { BuiltRule } from "./rule-builder.js";

const PERIOD_LABEL = `${String(REQUEST_METRIC_PERIOD.toMinutes())} minutes`;

/**
 * The alarm-key prefix for a rule: its name in camelCase, so `PerIpRate` and
 * `per-ip-rate` both become `perIpRate`.
 *
 * @internal
 */
export function ruleAlarmKey(name: string): string {
  const parts = name.split(/[-_]+/).filter(Boolean);
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function isOff(config: { enabled?: boolean } | false | undefined): boolean {
  return config === false || config?.enabled === false;
}

/** The managed rule group a statement pins to a version, if any. */
function pinnedGroup(
  statement: CfnWebACL.RuleProperty["statement"],
): ManagedRuleGroupVersion | undefined {
  // The rule builder only takes a `StatementProperty`, never a token.
  const group = (statement as CfnWebACL.StatementProperty).managedRuleGroupStatement;
  if (group === undefined || Token.isUnresolved(group)) return undefined;
  const { vendorName, name, version } = group as CfnWebACL.ManagedRuleGroupStatementProperty;
  return version === undefined ? undefined : { vendorName, name, version };
}

/**
 * Resolves each rule's recommended alarms into {@link AlarmDefinition}s.
 *
 * @internal
 */
export function resolveWebAclAlarmDefinitions(
  owner: string,
  metrics: WebAclMetrics,
  rules: readonly BuiltRule[],
  config: WebAclAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (isOff(config)) return [];
  const keys = new Map<string, string>();
  return rules.flatMap((rule) => {
    const definitions = resolveRuleAlarms(metrics, rule);
    if (definitions.length === 0) return [];
    const { name } = rule.property;
    const key = ruleAlarmKey(name);
    const other = keys.get(key);
    if (other !== undefined) {
      throw new Error(
        `${owner}: rules "${other}" and "${name}" both have alarm key "${key}", because ` +
          `alarm keys are rule names in camelCase. Rename one of them.`,
      );
    }
    keys.set(key, name);
    return definitions;
  });
}

function definition(
  key: string,
  metric: AlarmMetric,
  comparisonOperator: ComparisonOperator,
  userConfig: AlarmConfig | undefined,
  defaults: AlarmConfigDefaults,
  describe: (threshold: number) => string,
): AlarmDefinition {
  const { alarmName, threshold, evaluationPeriods, datapointsToAlarm, treatMissingData } =
    resolveAlarmConfig(userConfig, defaults);
  return {
    key,
    alarmName,
    metric,
    threshold,
    comparisonOperator,
    evaluationPeriods,
    datapointsToAlarm,
    treatMissingData,
    description: describe(threshold),
  };
}

function resolveRuleAlarms(metrics: WebAclMetrics, rule: BuiltRule): AlarmDefinition[] {
  const config = rule.alarms;
  if (isOff(config)) return [];
  const { name } = rule.property;
  const key = ruleAlarmKey(name);
  const definitions: AlarmDefinition[] = [];

  const blocked = config ? config.blockedRequests : undefined;
  // A rule group's managed rules block background noise, so its alarm is opt-in.
  if (rule.blocks && blocked !== false && (!rule.ruleGroup || blocked !== undefined)) {
    definitions.push(
      definition(
        `${key}BlockedRequests`,
        metrics.rule(name).blockedRequests(),
        ComparisonOperator.GREATER_THAN_THRESHOLD,
        blocked,
        WEB_ACL_RULE_ALARM_DEFAULTS.blockedRequests,
        (t) =>
          `WAF rule "${name}" is blocking requests. Threshold: > ${String(t)} blocked requests in ${PERIOD_LABEL}.`,
      ),
    );
  }

  const group = pinnedGroup(rule.property.statement);
  const expiry = config ? config.daysToExpiry : undefined;
  if (group && expiry !== false) {
    const version = Token.isUnresolved(group.version)
      ? "its pinned version"
      : `version ${group.version}`;
    definitions.push(
      definition(
        `${key}DaysToExpiry`,
        metrics.daysToExpiry(group),
        ComparisonOperator.LESS_THAN_THRESHOLD,
        expiry,
        WEB_ACL_RULE_ALARM_DEFAULTS.daysToExpiry,
        (t) =>
          `WAF rule "${name}" pins ${group.name} at ${version}, which expires in under ${String(t)} days. Move it to a newer version; WAF rejects updates to the web ACL once it expires.`,
      ),
    );
  }

  return definitions;
}
