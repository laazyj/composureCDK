import { type Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { QueueAlarmConfig, QueueAlarmKey } from "./queue-alarm-config.js";
import type { QueueAlarmProfile } from "./queue-alarm-profiles.js";
import { QUEUE_ALARM_METRICS } from "./queue-alarm-profiles.js";

const QUEUE_ALARM_KEYS = Object.keys(QUEUE_ALARM_METRICS) as QueueAlarmKey[];

/**
 * Non-threshold baseline for alarms enabled without a profile default —
 * the threshold itself must come from the user's config.
 */
const OPT_IN_ALARM_BASELINE = {
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
};

/**
 * Resolves the recommended alarm configuration into fully-resolved
 * {@link AlarmDefinition}s for an SQS queue.
 *
 * @param profile - The builder's alarm profile: which alarms are created
 *   without explicit opt-in and the defaults they merge against.
 */
export function resolveQueueAlarmDefinitions(
  queue: IQueue,
  config: QueueAlarmConfig | undefined,
  profile: QueueAlarmProfile,
): AlarmDefinition[] {
  if (config?.enabled === false) return [];

  return QUEUE_ALARM_KEYS.flatMap((key): AlarmDefinition[] => {
    const userConfig = config?.[key];
    if (userConfig === false) return [];
    if (userConfig === undefined && !profile.enablement[key]) return [];

    const baseline = profile.defaults[key];
    if (baseline === undefined && userConfig?.threshold === undefined) {
      throw new Error(
        `Queue "${queue.node.id}": the "${key}" alarm has no generic default threshold for ` +
          `this queue type — no value fits every workload. Supply one explicitly, e.g. ` +
          `recommendedAlarms({ ${key}: { threshold: … } }).`,
      );
    }

    const cfg = resolveAlarmConfig(
      userConfig,
      // userConfig.threshold is present whenever baseline is not — the guard above ensures it.
      baseline ?? { ...OPT_IN_ALARM_BASELINE, threshold: userConfig?.threshold ?? 0 },
    );
    return [
      {
        key,
        alarmName: cfg.alarmName,
        metric: QUEUE_ALARM_METRICS[key](queue),
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: profile.descriptions[key](cfg.threshold),
      },
    ];
  });
}

/**
 * Creates AWS-recommended CloudWatch alarms for an SQS queue, merging
 * recommended definitions with any custom alarm builders.
 *
 * @param scope - CDK construct scope for creating alarm constructs.
 * @param id - Base identifier for alarm construct ids.
 * @param queue - The SQS queue to create alarms for.
 * @param config - User-provided alarm configuration, or `false` to disable the
 *   recommended alarms.
 * @param customAlarms - Custom alarm builders added via `addAlarm()`.
 * @param profile - The builder's alarm profile; see
 *   {@link resolveQueueAlarmDefinitions}.
 * @returns A record mapping alarm keys to their created Alarm constructs.
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
 */
export function createQueueAlarms(
  scope: IConstruct,
  id: string,
  queue: IQueue,
  config: QueueAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<IQueue>[],
  profile: QueueAlarmProfile,
): Record<string, Alarm> {
  const recommended =
    config === false || config?.enabled === false
      ? []
      : resolveQueueAlarmDefinitions(queue, config, profile);
  const custom = customAlarms.map((b) => b.resolve(queue));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
