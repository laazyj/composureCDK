import { Annotations, Duration, Token } from "aws-cdk-lib";
import { type Alarm, Metric, Stats } from "aws-cdk-lib/aws-cloudwatch";
import { CfnStateMachineAlias, type StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import type { IConstruct } from "constructs";
import type { AlarmConfig, AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { ANY_OCCURRENCE } from "./alarm-defaults.js";
import { type AlarmSet, createSpecAlarms } from "./alarm-specs.js";

/**
 * How CloudFormation moves an alias to a newly published version.
 * `ALL_AT_ONCE` moves every execution at once, as a plain alias does. `CANARY`
 * and `LINEAR` shift traffic over time and roll the alias back if a rollback
 * alarm enters `ALARM` during the shift; build them with
 * {@link canaryDeployment} and {@link linearDeployment}.
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
 * Warning id for rollback alarms unlikely to roll anything back: on an
 * `ALL_AT_ONCE` alias, or on a shift with an interval under 5 minutes. The
 * alarms are still created, as asked, but fire after such a deployment
 * completes — see the package README. Acknowledge via
 * `Annotations.of(scope).acknowledgeWarning(INEFFECTIVE_ROLLBACK_ALARMS_WARNING_ID)`
 * where that is intended, so the id must stay stable.
 */
export const INEFFECTIVE_ROLLBACK_ALARMS_WARNING_ID =
  "@composurecdk/stepfunctions:ineffective-rollback-alarms";

/** The shortest shift interval rollback alarms reliably fire within. */
const MIN_ROLLBACK_INTERVAL = Duration.minutes(5);

/** Options for {@link canaryDeployment} and {@link linearDeployment}. */
export interface GradualDeploymentOptions {
  /** Traffic shifted per increment, 1–99. */
  readonly percentage?: number;
  /** Time between increments, 1–2100 whole minutes. */
  readonly interval?: Duration;
}

/**
 * {@link canaryDeployment}'s defaults: 10% for five minutes, the shape of AWS's
 * own example, long enough for the rollback alarms to fire.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/version-rolling-deployment.html
 */
export const DEFAULT_CANARY_DEPLOYMENT: Required<GradualDeploymentOptions> = {
  percentage: 10,
  interval: Duration.minutes(5),
};

/** {@link linearDeployment}'s defaults: 20% every five minutes, done in 25. */
export const DEFAULT_LINEAR_DEPLOYMENT: Required<GradualDeploymentOptions> = {
  percentage: 20,
  interval: Duration.minutes(5),
};

const gradual = (
  type: "CANARY" | "LINEAR",
  options: GradualDeploymentOptions,
  defaults: Required<GradualDeploymentOptions>,
): AliasDeployment => ({
  type,
  percentage: options.percentage ?? defaults.percentage,
  interval: options.interval ?? defaults.interval,
});

/**
 * Shift `percentage` of traffic, wait `interval`, then shift the rest, rolling
 * back on the alias's rollback alarms. Defaults: {@link DEFAULT_CANARY_DEPLOYMENT}.
 */
export function canaryDeployment(options: GradualDeploymentOptions = {}): AliasDeployment {
  return gradual("CANARY", options, DEFAULT_CANARY_DEPLOYMENT);
}

/**
 * Shift `percentage` of traffic every `interval` until it reaches 100%, rolling
 * back on the alias's rollback alarms. Defaults: {@link DEFAULT_LINEAR_DEPLOYMENT}.
 */
export function linearDeployment(options: GradualDeploymentOptions = {}): AliasDeployment {
  return gradual("LINEAR", options, DEFAULT_LINEAR_DEPLOYMENT);
}

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
   * @default executionsFailed and executionsTimedOut, scoped to the alias, for
   * `CANARY` and `LINEAR`; none for `ALL_AT_ONCE`
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

/** Warns when the alias's rollback alarms will fire after its deployment completes. */
function warnIfIneffective(target: IConstruct, name: string, deployment: AliasDeployment): void {
  const problem =
    deployment.type === "ALL_AT_ONCE"
      ? "rollbackAlarms on an ALL_AT_ONCE deployment will not roll it back; use canaryDeployment() or linearDeployment()."
      : deployment.interval.toMinutes() < MIN_ROLLBACK_INTERVAL.toMinutes()
        ? `a ${deployment.interval.toHumanString()} deployment interval is likely to complete before its rollback alarms fire; use at least ${MIN_ROLLBACK_INTERVAL.toHumanString()}.`
        : undefined;
  if (problem) {
    Annotations.of(target).addWarningV2(
      INEFFECTIVE_ROLLBACK_ALARMS_WARNING_ID,
      `alias "${name}": ${problem} Step Functions alarms fire one to two minutes after executions fail.`,
    );
  }
}

/**
 * Creates an alias pointing at `versionArn`, deployed with `options.deployment`
 * and, for a gradual deployment, rolled back on its alarms.
 */
export function createStateMachineAlias(
  scope: IConstruct,
  id: string,
  stateMachine: StateMachine,
  versionArn: string,
  name: string,
  options: AddAliasOptions,
): StateMachineAliasResult {
  const deployment = options.deployment ?? { type: "ALL_AT_ONCE" };
  // Rollback alarms default on only where they can act: an ALL_AT_ONCE
  // deployment completes before they fire.
  const alarms = createSpecAlarms(
    scope,
    id,
    stateMachine,
    aliasAlarms(name),
    options.rollbackAlarms ?? (deployment.type === "ALL_AT_ONCE" ? false : {}),
    [],
  );
  // CloudFormation requires alarm names, not ARNs, here: an ARN is treated as a
  // nonexistent alarm, which reads as OK, and the deployment never rolls back.
  const alarmNames = Object.values(alarms).map((alarm) => alarm.alarmName);
  if (alarmNames.length > 0) warnIfIneffective(stateMachine, name, deployment);
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
