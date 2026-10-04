import { type Duration, Token } from "aws-cdk-lib";
import { type Alarm, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { CfnStateMachineAlias, type StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import type { IConstruct } from "constructs";
import type { AlarmConfig, AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { ANY_OCCURRENCE } from "./alarm-defaults.js";
import { type AlarmSet, createSpecAlarms } from "./alarm-specs.js";

/**
 * How CloudFormation moves an alias to a newly published version. Any rollback
 * alarm entering `ALARM` during the shift rolls the alias back.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/version-rolling-deployment.html
 */
export type AliasDeployment =
  | { readonly type: "ALL_AT_ONCE" }
  | {
      /**
       * `CANARY` shifts `percentage` of traffic, waits `interval`, then shifts the
       * rest. `LINEAR` shifts `percentage` every `interval` until it reaches 100%.
       */
      readonly type: "CANARY" | "LINEAR";
      /** Traffic shifted per increment, 1–99. */
      readonly percentage: number;
      /** Time between increments, 1–2100 whole minutes. */
      readonly interval: Duration;
    };

/**
 * Controls the alarms an alias's deployment rolls back on. Each watches only
 * executions started through the alias, and is on by default; set one to
 * `false` to disable it, or pass an {@link AlarmConfig} to tune it.
 */
export interface StateMachineAliasAlarmConfig {
  /** Master switch: set to `false` to disable all rollback alarms. @default true */
  enabled?: boolean;
  /** Alarm when executions through the alias fail. Metric: `AWS/States ExecutionsFailed`. */
  executionsFailed?: AlarmConfig | false;
  /** Alarm when executions through the alias time out. Metric: `AWS/States ExecutionsTimedOut`. */
  executionsTimedOut?: AlarmConfig | false;
}

/** Options for {@link IStateMachineBuilder.addAlias}. */
export interface AddAliasOptions {
  /** @default - no description */
  readonly description?: string;
  /**
   * How the alias moves to each newly published version.
   * @default { type: "ALL_AT_ONCE" }
   */
  readonly deployment?: AliasDeployment;
  /**
   * The alarms the deployment rolls back on, or `false` for none.
   * @default the executionsFailed and executionsTimedOut alarms, scoped to the alias
   */
  readonly rollbackAlarms?: StateMachineAliasAlarmConfig | false;
}

/** One alias in {@link StateMachineBuilderResult.aliases}. */
export interface StateMachineAliasResult {
  /** The alias; callers start executions against its `attrArn`. */
  readonly alias: CfnStateMachineAlias;
  /** The rollback alarms, keyed by alarm name. */
  readonly alarms: Record<string, Alarm>;
}

/** Defaults for the rollback alarms; alarm on the first occurrence. */
export const STATE_MACHINE_ALIAS_ALARM_DEFAULTS: {
  enabled: true;
  executionsFailed: AlarmConfigDefaults;
  executionsTimedOut: AlarmConfigDefaults;
} = {
  enabled: true,
  executionsFailed: ANY_OCCURRENCE,
  executionsTimedOut: ANY_OCCURRENCE,
};

/**
 * The rollback alarms for one alias: executions started through it, by the
 * `{StateMachineArn, Alias}` dimensions.
 */
function aliasAlarms(
  name: string,
): AlarmSet<StateMachine, Exclude<keyof StateMachineAliasAlarmConfig, "enabled">> {
  const metric = (metricName: string) => (sm: StateMachine, options: { period?: Duration }) =>
    new Metric({
      namespace: "AWS/States",
      metricName,
      dimensionsMap: { StateMachineArn: sm.stateMachineArn, Alias: name },
      statistic: Stats.SUM,
      ...options,
    });
  return {
    defaults: STATE_MACHINE_ALIAS_ALARM_DEFAULTS,
    specs: {
      executionsFailed: {
        metric: metric("ExecutionsFailed"),
        describe: "State machine executions through the alias are failing.",
      },
      executionsTimedOut: {
        metric: metric("ExecutionsTimedOut"),
        describe: "State machine executions through the alias are timing out.",
      },
    },
  };
}

/** Step Functions' alias name rule: letters, digits, `-`, `_`, `.`, at least one non-digit. */
const ALIAS_NAME = /^(?=.*[a-zA-Z_\-.])[a-zA-Z0-9_\-.]{1,80}$/;

/** Throws on alias options CloudFormation would reject at deploy time. */
export function validateAlias(builderId: string, name: string, options: AddAliasOptions): void {
  const fail = (message: string): never => {
    throw new Error(`StateMachineBuilder "${builderId}" alias "${name}": ${message}`);
  };
  if (!Token.isUnresolved(name) && !ALIAS_NAME.test(name)) {
    fail("must be 1–80 letters, digits, '-', '_' or '.', with at least one non-digit.");
  }
  const deployment = options.deployment;
  if (deployment && deployment.type !== "ALL_AT_ONCE") {
    const { percentage, interval } = deployment;
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 99) {
      fail(`deployment percentage must be a whole number 1–99, got ${String(percentage)}.`);
    }
    const minutes = interval.toMinutes({ integral: false });
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 2100) {
      fail(`deployment interval must be 1–2100 whole minutes, got ${interval.toHumanString()}.`);
    }
  }
}

/**
 * Creates an alias pointing at `versionArn`, deployed with `options.deployment`
 * and rolled back on its alarms.
 */
export function createStateMachineAlias(
  scope: IConstruct,
  id: string,
  stateMachine: StateMachine,
  versionArn: string,
  name: string,
  options: AddAliasOptions,
): StateMachineAliasResult {
  const alarms = createSpecAlarms(
    scope,
    id,
    stateMachine,
    aliasAlarms(name),
    options.rollbackAlarms,
    [],
  );
  // CloudFormation requires alarm names, not ARNs, here: an ARN is treated as a
  // nonexistent alarm, which reads as OK, and the deployment never rolls back.
  const alarmNames = Object.values(alarms).map((alarm) => alarm.alarmName);
  const deployment = options.deployment ?? { type: "ALL_AT_ONCE" };
  const alias = new CfnStateMachineAlias(scope, id, {
    name,
    description: options.description,
    deploymentPreference: {
      stateMachineVersionArn: versionArn,
      type: deployment.type,
      ...(deployment.type === "ALL_AT_ONCE"
        ? {}
        : { percentage: deployment.percentage, interval: deployment.interval.toMinutes() }),
      ...(alarmNames.length > 0 ? { alarms: alarmNames } : {}),
    },
  });
  return { alias, alarms };
}
