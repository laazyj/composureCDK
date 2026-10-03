import { type StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import type { AlarmSet } from "./alarm-specs.js";
import type { StateMachineAlarmConfig } from "./state-machine-alarm-config.js";
import { STATE_MACHINE_ALARM_DEFAULTS } from "./state-machine-alarm-defaults.js";

/** A state machine's recommended alarms, keyed so a config field without a spec is a type error. */
export const STATE_MACHINE_ALARMS: AlarmSet<
  StateMachine,
  Exclude<keyof StateMachineAlarmConfig, "enabled">
> = {
  defaults: STATE_MACHINE_ALARM_DEFAULTS,
  specs: {
    executionsFailed: {
      metric: (sm, options) => sm.metricFailed(options),
      describe: "State machine executions are failing.",
    },
    executionsTimedOut: {
      metric: (sm, options) => sm.metricTimedOut(options),
      describe: "State machine executions are timing out.",
    },
    executionThrottled: {
      metric: (sm, options) => sm.metricThrottled(options),
      appliesTo: (sm) => sm.stateMachineType === StateMachineType.STANDARD,
      describe:
        "State machine state transitions are being throttled; consider a Standard workflow quota increase.",
    },
  },
};
