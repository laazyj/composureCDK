import {
  ComparisonOperator,
  MathExpression,
  Metric,
  type MetricOptions,
} from "aws-cdk-lib/aws-cloudwatch";
import type { IConstruct } from "constructs";
import { COPY_STATE, type Lifecycle } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import {
  type AlarmConfig,
  type AlarmConfigDefaults,
  type AlarmConfigurer,
  type AlarmDefinition,
  AlarmDefinitionBuilder,
  type AlarmMetric,
  type AlarmsOf,
  createAlarms,
  resolveAlarmConfig,
  type WithCustomAlarms,
} from "@composurecdk/cloudwatch";
import type {
  AccountAlarmConfig,
  AccountAlarmKey,
  OpenExecutionsAlarmConfig,
} from "./account-alarm-config.js";
import { ACCOUNT_ALARM_DEFAULTS } from "./account-alarm-defaults.js";
import { describeThreshold, METRIC_PERIOD } from "./alarm-specs.js";

/** The account's `AWS/States` metrics, for alarms added with `addAlarm()`. */
export interface AccountMetrics {
  /**
   * An `AWS/States` metric on a 1-minute period, with no dimensions unless
   * `options.dimensionsMap` sets them.
   */
  metric(metricName: string, options?: MetricOptions): Metric;
}

const ACCOUNT_METRICS: AccountMetrics = {
  metric: (metricName, options) =>
    new Metric({ namespace: "AWS/States", metricName, period: METRIC_PERIOD, ...options }),
};

/** Configuration properties for {@link createAccountAlarmBuilder}. */
export interface AccountAlarmBuilderProps {
  /**
   * The recommended alarms: see {@link AccountAlarmConfig}. `openExecutions`
   * and `openMapRuns` are on by default; the rest are opt-in. Set to `false`
   * to disable them; alarms added with `addAlarm()` are unaffected.
   *
   * No alarm actions are configured. Use `alarmActionsPolicy` or an
   * `afterBuild` hook to route them.
   */
  recommendedAlarms?: AccountAlarmConfig | false;
}

/** The build output of an {@link IAccountAlarmBuilder}. */
export interface AccountAlarmBuilderResult {
  /**
   * The CloudWatch alarms created, keyed by alarm key: the recommended alarms
   * that are on, and any added via `addAlarm()`. To read a custom alarm by
   * key, name it with {@link WithCustomAlarms}.
   */
  alarms: AlarmsOf<AccountAlarmKey>;
}

/**
 * A fluent builder for alarms on Step Functions' account-wide quotas.
 *
 * @see {@link createAccountAlarmBuilder}
 */
export type IAccountAlarmBuilder = ITaggedBuilder<AccountAlarmBuilderProps, AccountAlarmBuilder>;

interface AccountAlarmSpec {
  metric: AlarmMetric;
  /** Created when the caller leaves it unconfigured. */
  enabledByDefault: boolean;
  describe: (threshold: number) => string;
}

function maximum(metricName: string): Metric {
  return ACCOUNT_METRICS.metric(metricName, { statistic: "Maximum" });
}

function throttled(dimensionsMap: Record<string, string>): Metric {
  return ACCOUNT_METRICS.metric("ThrottledEvents", { statistic: "Sum", dimensionsMap });
}

const { thresholdPercent: openExecutionsThreshold, ...openExecutionsDefaults } =
  ACCOUNT_ALARM_DEFAULTS.openExecutions;

/** {@link ACCOUNT_ALARM_DEFAULTS} by alarm key, with `openExecutions`' fraction as its threshold. */
const DEFAULTS: Record<
  AccountAlarmKey,
  Omit<AlarmConfigDefaults, "threshold"> & { threshold?: number }
> = {
  ...ACCOUNT_ALARM_DEFAULTS,
  openExecutions: { ...openExecutionsDefaults, threshold: openExecutionsThreshold },
};

const SPECS: Record<AccountAlarmKey, AccountAlarmSpec> = {
  openExecutions: {
    metric: new MathExpression({
      expression: "count / limit",
      usingMetrics: { count: maximum("OpenExecutionCount"), limit: maximum("OpenExecutionLimit") },
      period: METRIC_PERIOD,
      label: "Open executions / quota",
    }),
    enabledByDefault: true,
    describe: (t) =>
      `Open Standard executions exceed ${String(t * 100)}% of the account's open-execution ` +
      `quota. At the quota, StartExecution fails with ExecutionLimitExceeded.`,
  },
  openMapRuns: {
    metric: maximum("ApproximateOpenMapRunCount"),
    enabledByDefault: true,
    describe: (t) =>
      `Open Map Runs are nearing the hard quota of 1,000; past it, new Map Runs are ` +
      `backlogged. ${describeThreshold(t)}`,
  },
  mapRunBacklog: {
    metric: maximum("ApproximateMapRunBacklogSize"),
    enabledByDefault: false,
    describe: (t) =>
      `Map Runs are backlogged, waiting for open Map Runs to drop below the quota. ` +
      describeThreshold(t),
  },
  startExecutionThrottled: {
    metric: throttled({ APIName: "StartExecution" }),
    enabledByDefault: false,
    describe: (t) => `StartExecution calls are being throttled. ${describeThreshold(t)}`,
  },
  stateTransitionThrottled: {
    metric: throttled({ ServiceMetric: "StateTransition" }),
    enabledByDefault: false,
    describe: (t) =>
      `State transitions are being throttled across the account; consider a Standard ` +
      `workflow quota increase. ${describeThreshold(t)}`,
  },
};

/** Maps `thresholdPercent` onto the threshold the ratio alarm compares against. */
function openExecutionsConfig(
  config: OpenExecutionsAlarmConfig | false | undefined,
): AlarmConfig | false | undefined {
  if (!config) return config;
  const { thresholdPercent, ...rest } = config;
  if (thresholdPercent === undefined) return rest;
  if (!(thresholdPercent > 0 && thresholdPercent <= 1)) {
    throw new Error(
      `openExecutions: thresholdPercent must be in (0, 1], got ${String(thresholdPercent)}.`,
    );
  }
  return { ...rest, threshold: thresholdPercent };
}

function recommendedAlarms(config: AccountAlarmConfig | false | undefined): AlarmDefinition[] {
  if (config === false || config?.enabled === false) return [];
  const configs: Partial<Record<AccountAlarmKey, AlarmConfig | false>> = {
    ...config,
    openExecutions: openExecutionsConfig(config?.openExecutions),
  };
  return (Object.keys(SPECS) as AccountAlarmKey[]).flatMap((key) => {
    const spec = SPECS[key];
    const userConfig = configs[key];
    if (userConfig === false || (userConfig === undefined && !spec.enabledByDefault)) return [];
    const threshold = userConfig?.threshold ?? DEFAULTS[key].threshold;
    if (threshold === undefined) {
      throw new Error(
        `The "${key}" alarm has no default threshold. Supply one, e.g. ` +
          `recommendedAlarms({ ${key}: { threshold: … } }).`,
      );
    }
    const cfg = resolveAlarmConfig(userConfig, { ...DEFAULTS[key], threshold });
    return [
      {
        key,
        alarmName: cfg.alarmName,
        metric: spec.metric,
        threshold: cfg.threshold,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: cfg.evaluationPeriods,
        datapointsToAlarm: cfg.datapointsToAlarm,
        treatMissingData: cfg.treatMissingData,
        description: spec.describe(cfg.threshold),
      },
    ];
  });
}

class AccountAlarmBuilder implements Lifecycle<
  WithCustomAlarms<AccountAlarmBuilderResult, string>
> {
  props: AccountAlarmBuilderProps = {};
  readonly #customAlarms: AlarmDefinitionBuilder<AccountMetrics>[] = [];

  /**
   * Adds a custom alarm. The metric factory receives the account's
   * {@link AccountMetrics}, e.g.
   * `(a) => a.metric((m) => m.metric("ExecutionsFailed", { statistic: "Sum" })).threshold(10)`.
   */
  addAlarm(key: string, configure: AlarmConfigurer<AccountMetrics>): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<AccountMetrics>(key)));
    return this;
  }

  /**
   * Adds a set of custom alarms in one call: each entry exactly as if by
   * `addAlarm(key, configure)`, in the record's iteration order.
   */
  addAlarms(alarms: Record<string, AlarmConfigurer<AccountMetrics>>): this {
    for (const [key, configure] of Object.entries(alarms)) {
      this.addAlarm(key, configure);
    }
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: AccountAlarmBuilder): void {
    target.#customAlarms.push(...this.#customAlarms);
  }

  build(scope: IConstruct, id: string): WithCustomAlarms<AccountAlarmBuilderResult, string> {
    return {
      alarms: createAlarms(scope, id, [
        ...recommendedAlarms(this.props.recommendedAlarms),
        ...this.#customAlarms.map((b) => b.resolve(ACCOUNT_METRICS)),
      ]),
    };
  }
}

/**
 * Creates alarms on Step Functions' account-wide quotas: open executions,
 * open Map Runs, the Map Run backlog and throttling.
 *
 * These metrics have no dimensions and cover every workflow in the account
 * and Region, so build **one per account and Region**, not one per state
 * machine; two builders in one account and Region create duplicate alarms.
 *
 * @example
 * ```ts
 * createAccountAlarmBuilder().recommendedAlarms({
 *   openExecutions: { thresholdPercent: 0.2 },
 *   startExecutionThrottled: {},
 * });
 * ```
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html
 */
export function createAccountAlarmBuilder(): IAccountAlarmBuilder {
  return taggedBuilder<AccountAlarmBuilderProps, AccountAlarmBuilder>(AccountAlarmBuilder);
}
