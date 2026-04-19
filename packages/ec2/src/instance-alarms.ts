import { Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import type { IInstance, Instance, InstanceProps } from "aws-cdk-lib/aws-ec2";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { InstanceAlarmConfig } from "./instance-alarm-config.js";
import { INSTANCE_ALARM_DEFAULTS } from "./instance-alarm-defaults.js";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

/**
 * CPU credit metrics are emitted by EC2 at 5-minute granularity regardless
 * of whether detailed monitoring is enabled. Using a shorter period yields
 * missing data rather than higher resolution.
 *
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/viewing_credits_CPU.html
 */
const CREDIT_METRIC_PERIOD = Duration.minutes(5);
const CREDIT_METRIC_PERIOD_LABEL = `${String(CREDIT_METRIC_PERIOD.toMinutes())} minute`;

/**
 * Instance type family prefixes that accrue CPU credits (burstable).
 * Used to decide whether to emit the contextual {@link InstanceAlarmConfig.cpuCreditBalance}
 * alarm. Other families bill at a flat CPU rate and have no credit metric.
 *
 * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances.html
 */
const BURSTABLE_FAMILY_PREFIXES = ["t2.", "t3.", "t3a.", "t4g."] as const;

function isBurstableInstanceType(instanceType: InstanceProps["instanceType"]): boolean {
  const identifier = instanceType.toString();
  return BURSTABLE_FAMILY_PREFIXES.some((prefix) => identifier.startsWith(prefix));
}

function cpuUtilizationMetric(instance: IInstance): Metric {
  return new Metric({
    namespace: "AWS/EC2",
    metricName: "CPUUtilization",
    dimensionsMap: { InstanceId: instance.instanceId },
    statistic: Stats.AVERAGE,
    period: METRIC_PERIOD,
  });
}

function statusCheckFailedMetric(instance: IInstance): Metric {
  return new Metric({
    namespace: "AWS/EC2",
    metricName: "StatusCheckFailed",
    dimensionsMap: { InstanceId: instance.instanceId },
    statistic: Stats.SUM,
    period: METRIC_PERIOD,
  });
}

function cpuCreditBalanceMetric(instance: IInstance): Metric {
  return new Metric({
    namespace: "AWS/EC2",
    metricName: "CPUCreditBalance",
    dimensionsMap: { InstanceId: instance.instanceId },
    statistic: Stats.MINIMUM,
    period: CREDIT_METRIC_PERIOD,
  });
}

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s, applying contextual logic for the
 * burstable-only CPU credit alarm.
 */
export function resolveInstanceAlarmDefinitions(
  instance: Instance,
  config: InstanceAlarmConfig | undefined,
  props: Pick<InstanceProps, "instanceType">,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  const definitions: AlarmDefinition[] = [];

  if (config?.cpuUtilization !== false) {
    const cfg = resolveAlarmConfig(config?.cpuUtilization, INSTANCE_ALARM_DEFAULTS.cpuUtilization);
    definitions.push({
      key: "cpuUtilization",
      metric: cpuUtilizationMetric(instance),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EC2 instance CPU utilization is sustained at a high level. Threshold: > ${String(cfg.threshold)}% average over ${String(cfg.evaluationPeriods)} x ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.statusCheckFailed !== false) {
    const cfg = resolveAlarmConfig(
      config?.statusCheckFailed,
      INSTANCE_ALARM_DEFAULTS.statusCheckFailed,
    );
    definitions.push({
      key: "statusCheckFailed",
      metric: statusCheckFailedMetric(instance),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EC2 instance is failing its status checks. Threshold: > ${String(cfg.threshold)} failed checks over ${String(cfg.evaluationPeriods)} x ${METRIC_PERIOD_LABEL}.`,
    });
  }

  if (config?.cpuCreditBalance !== false && isBurstableInstanceType(props.instanceType)) {
    const cfg = resolveAlarmConfig(
      config?.cpuCreditBalance,
      INSTANCE_ALARM_DEFAULTS.cpuCreditBalance,
    );
    definitions.push({
      key: "cpuCreditBalance",
      metric: cpuCreditBalanceMetric(instance),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `EC2 burstable instance CPU credit balance is low — baseline throttling is imminent. Threshold: < ${String(cfg.threshold)} credits (minimum) over ${String(cfg.evaluationPeriods)} x ${CREDIT_METRIC_PERIOD_LABEL}.`,
    });
  }

  return definitions;
}

/**
 * Creates AWS-recommended CloudWatch alarms for an EC2 instance,
 * merging recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param instance - The EC2 instance to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable all.
 * @param props - The merged instance props, used for contextual alarm thresholds.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EC2
 */
export function createInstanceAlarms(
  scope: IConstruct,
  id: string,
  instance: Instance,
  config: InstanceAlarmConfig | false | undefined,
  props: Pick<InstanceProps, "instanceType">,
  customAlarms: AlarmDefinitionBuilder<Instance>[] = [],
): Record<string, Alarm> {
  if (config === false) return {};

  const enabled = config?.enabled ?? INSTANCE_ALARM_DEFAULTS.enabled;
  if (!enabled) return {};

  const recommended = resolveInstanceAlarmDefinitions(instance, config, props);
  const custom = customAlarms.map((b) => b.resolve(instance));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
