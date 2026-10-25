import { CfnResource, Duration, Stack } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric } from "aws-cdk-lib/aws-cloudwatch";
import { CfnRule, type IRule } from "aws-cdk-lib/aws-events";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { RuleAlarmConfig } from "./rule-alarm-config.js";
import { RULE_ALARM_DEFAULTS } from "./rule-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

function ruleMetric(rule: IRule, metricName: string): Metric {
  return new Metric({
    namespace: "AWS/Events",
    metricName,
    dimensionsMap: { RuleName: rule.ruleName },
    statistic: "Sum",
    period: METRIC_PERIOD,
  });
}

/** Narrows to an `AWS::Events::Rule` L1 without `instanceof` — see ADR-0007/ADR-0011. */
function isCfnRule(node: IConstruct | undefined): node is CfnRule {
  return (
    node !== undefined &&
    CfnResource.isCfnResource(node) &&
    node.cfnResourceType === CfnRule.CFN_RESOURCE_TYPE_NAME
  );
}

/**
 * Whether any target bound to the rule so far has a dead-letter queue, read
 * off the rule's L1 `CfnRule` rather than the targets' classes, so it holds
 * across the ESM and CJS copies of `aws-cdk-lib`. `Rule` sets `targets` to a
 * lazy value, so it has to be resolved. An imported rule has no L1, so it
 * reports `false`.
 */
function hasTargetDeadLetterQueue(rule: IRule): boolean {
  const cfnRule = rule.node.defaultChild;
  if (!isCfnRule(cfnRule)) return false;
  const targets = Stack.of(rule).resolve(cfnRule.targets) as
    { deadLetterConfig?: unknown }[] | undefined;
  return (targets ?? []).some((t) => t.deadLetterConfig !== undefined);
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an EventBridge rule.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EventBridge
 */
export function resolveRuleAlarmDefinitions(
  rule: IRule,
  config: RuleAlarmConfig | undefined,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];
  // An omitted DLQ alarm resolves to defaults (`{}`) only when there is a DLQ to watch.
  const dlqDefault = hasTargetDeadLetterQueue(rule) ? {} : false;
  const sentToDlq = config?.invocationsSentToDlq ?? dlqDefault;
  const failedToBeSentToDlq = config?.invocationsFailedToBeSentToDlq ?? dlqDefault;

  if (config?.failedInvocations !== false) {
    const cfg = resolveAlarmConfig(
      config?.failedInvocations,
      RULE_ALARM_DEFAULTS.failedInvocations,
    );
    definitions.push({
      key: "failedInvocations",
      alarmName: cfg.alarmName,
      metric: ruleMetric(rule, "FailedInvocations"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EventBridge rule is failing to invoke targets. Threshold: > ${String(cfg.threshold)} failures in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.throttledRules !== false) {
    const cfg = resolveAlarmConfig(config?.throttledRules, RULE_ALARM_DEFAULTS.throttledRules);
    definitions.push({
      key: "throttledRules",
      alarmName: cfg.alarmName,
      metric: ruleMetric(rule, "ThrottledRules"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EventBridge rule is being throttled, indicating quota or downstream concurrency limits. Threshold: > ${String(cfg.threshold)} throttles in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (sentToDlq !== false) {
    const cfg = resolveAlarmConfig(sentToDlq, RULE_ALARM_DEFAULTS.invocationsSentToDlq);
    definitions.push({
      key: "invocationsSentToDlq",
      alarmName: cfg.alarmName,
      metric: ruleMetric(rule, "InvocationsSentToDlq"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EventBridge rule is redriving events to a target dead-letter queue. Threshold: > ${String(cfg.threshold)} redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (failedToBeSentToDlq !== false) {
    const cfg = resolveAlarmConfig(
      failedToBeSentToDlq,
      RULE_ALARM_DEFAULTS.invocationsFailedToBeSentToDlq,
    );
    definitions.push({
      key: "invocationsFailedToBeSentToDlq",
      alarmName: cfg.alarmName,
      metric: ruleMetric(rule, "InvocationsFailedToBeSentToDlq"),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EventBridge rule failed to redrive an event to a target dead-letter queue; events may be lost. Threshold: > ${String(cfg.threshold)} failed redrives in ${METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an EventBridge rule,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param rule - The EventBridge rule to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EventBridge
 */
export function createRuleAlarms(
  scope: IConstruct,
  id: string,
  rule: IRule,
  config: RuleAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IRule>[] = [],
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false ? [] : resolveRuleAlarmDefinitions(rule, config);
  const custom = customAlarms.map((b) => b.resolve(rule));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
