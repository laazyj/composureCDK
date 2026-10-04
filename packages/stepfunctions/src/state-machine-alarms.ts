import { Annotations, Duration } from "aws-cdk-lib";
import { type Alarm, ComparisonOperator, type Metric } from "aws-cdk-lib/aws-cloudwatch";
import { type StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import type { IConstruct } from "constructs";
import type { AlarmDefinition, AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { createAlarms, resolveAlarmConfig } from "@composurecdk/cloudwatch";
import type { StateMachineAlarmConfig } from "./state-machine-alarm-config.js";
import { STATE_MACHINE_ALARM_DEFAULTS } from "./state-machine-alarm-defaults.js";

/**
 * Warning id for a recommended alarm configured on a state machine type it does
 * not apply to. The configuration is ignored. Acknowledge via
 * `Annotations.of(scope).acknowledgeWarning(INAPPLICABLE_ALARM_CONFIG_WARNING_ID)`
 * where that is intended, so the id must stay stable.
 */
export const INAPPLICABLE_ALARM_CONFIG_WARNING_ID =
  "@composurecdk/stepfunctions:inapplicable-alarm-config";

const METRIC_PERIOD = Duration.minutes(1);
const METRIC_PERIOD_LABEL = `${String(METRIC_PERIOD.toMinutes())} minute`;

type AlarmKey = Exclude<keyof StateMachineAlarmConfig, "enabled">;

interface AlarmSpec {
  metric: (sm: StateMachine) => Metric;
  /** Created only for a Standard state machine. */
  standardOnly?: true;
  describe: string;
}

/** Keyed by alarm, so a config field without a spec is a type error. */
const SPECS: Record<AlarmKey, AlarmSpec> = {
  executionsFailed: {
    metric: (sm) => sm.metricFailed({ period: METRIC_PERIOD }),
    describe: "State machine executions are failing.",
  },
  executionsTimedOut: {
    metric: (sm) => sm.metricTimedOut({ period: METRIC_PERIOD }),
    describe: "State machine executions are timing out.",
  },
  executionThrottled: {
    metric: (sm) => sm.metricThrottled({ period: METRIC_PERIOD }),
    standardOnly: true,
    describe:
      "State machine state transitions are being throttled; consider a Standard workflow quota increase.",
  },
};

/**
 * Resolves the recommended alarm configuration into {@link AlarmDefinition}s
 * for a state machine, skipping any whose metric does not apply to its type.
 */
export function resolveStateMachineAlarmDefinitions(
  stateMachine: StateMachine,
  config: StateMachineAlarmConfig | false | undefined,
): AlarmDefinition[] {
  if (config === false || config?.enabled === false) return [];

  const isStandard = stateMachine.stateMachineType === StateMachineType.STANDARD;
  return (Object.keys(SPECS) as AlarmKey[]).flatMap((key) => {
    const spec = SPECS[key];
    const userConfig = config?.[key];
    const inapplicable = spec.standardOnly && !isStandard;
    if (inapplicable && userConfig) {
      Annotations.of(stateMachine).addWarningV2(
        INAPPLICABLE_ALARM_CONFIG_WARNING_ID,
        `recommendedAlarms.${key} applies only to Standard state machines; the alarm is ` +
          `not created. Remove the setting or set it to false.`,
      );
    }
    if (userConfig === false || inapplicable) return [];
    const cfg = resolveAlarmConfig(userConfig, STATE_MACHINE_ALARM_DEFAULTS[key]);
    return {
      key,
      alarmName: cfg.alarmName,
      metric: spec.metric(stateMachine),
      threshold: cfg.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: cfg.evaluationPeriods,
      datapointsToAlarm: cfg.datapointsToAlarm,
      treatMissingData: cfg.treatMissingData,
      description: `${spec.describe} Threshold: > ${String(cfg.threshold)} in ${METRIC_PERIOD_LABEL}.`,
    };
  });
}

/**
 * Creates the recommended CloudWatch alarms for a state machine, merged with
 * any custom alarms added via `addAlarm()`.
 *
 * @returns A record mapping alarm keys to their created Alarm constructs.
 */
export function createStateMachineAlarms(
  scope: IConstruct,
  id: string,
  stateMachine: StateMachine,
  config: StateMachineAlarmConfig | false | undefined,
  customAlarms: AlarmDefinitionBuilder<StateMachine>[] = [],
): Record<string, Alarm> {
  const recommended = resolveStateMachineAlarmDefinitions(stateMachine, config);
  const custom = customAlarms.map((b) => b.resolve(stateMachine));

  return createAlarms(scope, id, [...recommended, ...custom]);
}
