import { CfnBudget, type CfnBudgetProps } from "aws-cdk-lib/aws-budgets";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { ITopic, TopicPolicy } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { BudgetAlarmConfig } from "./alarm-config.js";
import { buildBudgetAlarms } from "./budget-alarm-builder.js";
import { BUDGET_DEFAULTS } from "./defaults.js";
import {
  type BudgetSubscriber,
  type NotificationEntry,
  type NotificationType,
  resolveSubscribers,
  toCfnNotificationWithSubscribers,
} from "./notifications.js";
import { createBudgetsTopicPolicies } from "./topic-policy.js";

/**
 * Spend limit for a cost or usage budget.
 */
export interface BudgetLimit {
  /** Numeric limit. */
  amount: number;
  /**
   * Currency or usage unit. Defaults to
   * {@link BUDGET_DEFAULTS.limitUnit} when omitted.
   */
  unit?: string;
}

/**
 * Configuration properties for the budget builder.
 */
export interface BudgetBuilderProps {
  /** Name used for `BudgetName` in the `BudgetData` property. */
  budgetName?: string;
  /**
   * One of `COST`, `USAGE`, `RI_UTILIZATION`, `RI_COVERAGE`,
   * `SAVINGS_PLANS_UTILIZATION`, `SAVINGS_PLANS_COVERAGE`.
   *
   * @default "COST"
   */
  budgetType?: string;
  /** @default "MONTHLY" */
  timeUnit?: string;
  /** Spend limit (required for COST and USAGE budgets). */
  limit?: BudgetLimit;
  /**
   * CloudFormation `CostFilters` map. Keys are filter dimensions
   * (`Service`, `Region`, `LinkedAccount`, `TagKeyValue`, …) and values
   * are arrays of filter values.
   */
  costFilters?: Record<string, string[]>;
  /** CloudFormation `CostTypes` passthrough. */
  costTypes?: CfnBudget.CostTypesProperty;
  /**
   * Configuration for the AWS-recommended billing alarm.
   *
   * Off by default — pass an
   * {@link BudgetAlarmConfig.estimatedCharges} entry to opt in. Set to
   * `false` to suppress recommended alarms entirely; custom alarms added
   * via {@link IBudgetBuilder.addAlarm} are unaffected.
   *
   * Note: `AWS/Billing EstimatedCharges` is emitted in `us-east-1` only.
   * If this builder is used outside `us-east-1`, the synthesised alarm
   * will never receive data — the builder emits a synth-time warning.
   * For non-`us-east-1` stacks, suppress this builder's alarms with
   * `recommendedAlarms: false` and create alarms in a `us-east-1` stack
   * via {@link createBudgetAlarmBuilder}.
   *
   * @see BudgetAlarmConfig
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
   */
  recommendedAlarms?: BudgetAlarmConfig | false;
}

/**
 * The build output of an {@link IBudgetBuilder}.
 */
export interface BudgetBuilderResult {
  /** The `AWS::Budgets::Budget` construct. */
  budget: CfnBudget;
  /**
   * `AWS::SNS::TopicPolicy` constructs created automatically for any SNS
   * topic referenced as a notification subscriber, keyed by the topic's
   * fully-qualified node path. Grants `budgets.amazonaws.com` permission
   * to publish.
   *
   * `{}` when no SNS subscribers were configured.
   */
  topicPolicies: Record<string, TopicPolicy>;
  /**
   * CloudWatch alarms created for the budget.
   *
   * Includes both AWS-recommended alarms (`estimatedCharges`, off by
   * default) and any custom alarms added via
   * {@link IBudgetBuilder.addAlarm}. Empty unless the caller opts in via
   * `recommendedAlarms` or `addAlarm`.
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for configuring and creating an AWS Budget.
 *
 * Wraps the {@link CfnBudget} L1 construct (the CDK does not ship an L2
 * for Budgets) with well-architected defaults, helpers for the
 * percentage-threshold notification shape, and automatic
 * `AWS::SNS::TopicPolicy` wiring for SNS subscribers.
 *
 * The builder can also create the AWS-recommended `EstimatedCharges`
 * billing alarm; opt in via `recommendedAlarms`. For non-`us-east-1`
 * stacks, route the alarms separately via
 * {@link createBudgetAlarmBuilder}.
 *
 * @example
 * ```ts
 * createBudgetBuilder()
 *   .budgetName("AgentBudget")
 *   .limit({ amount: 50, unit: "GBP" })
 *   .notifyOnActual(100, ref("alerts", r => r.topic))
 *   .withRecommendedThresholds()
 *   .build(stack, "AgentBudget");
 * ```
 */
export type IBudgetBuilder = IBuilder<BudgetBuilderProps, BudgetBuilder>;

class BudgetBuilder implements Lifecycle<BudgetBuilderResult> {
  props: Partial<BudgetBuilderProps> = {};
  readonly #notifications: NotificationEntry[] = [];
  readonly #customAlarms: AlarmDefinitionBuilder<CfnBudget>[] = [];

  /**
   * Add a notification that fires when ACTUAL spend crosses the given
   * percentage of the budget limit.
   *
   * @param thresholdPercent - Percentage of the budget limit (e.g. `80`).
   *   For absolute-value thresholds, use {@link addNotification} directly.
   * @param subscribers - One or more email addresses / SNS topics (or
   *   {@link Resolvable} refs to topics).
   */
  notifyOnActual(thresholdPercent: number, ...subscribers: BudgetSubscriber[]): this {
    return this.#addPercentageNotification("ACTUAL", thresholdPercent, subscribers);
  }

  /**
   * Add a notification that fires when FORECASTED spend crosses the
   * given percentage of the budget limit.
   *
   * @param thresholdPercent - Percentage of the budget limit (e.g. `100`).
   *   For absolute-value thresholds, use {@link addNotification} directly.
   */
  notifyOnForecasted(thresholdPercent: number, ...subscribers: BudgetSubscriber[]): this {
    return this.#addPercentageNotification("FORECASTED", thresholdPercent, subscribers);
  }

  /**
   * Raw notification passthrough for callers that need the full
   * CloudFormation surface (e.g. absolute-value thresholds).
   */
  addNotification(entry: NotificationEntry): this {
    this.#notifications.push(entry);
    return this;
  }

  /**
   * Apply the well-architected recommended notification thresholds:
   *
   * - `ACTUAL` at 80% — early warning before breach.
   * - `FORECASTED` at 100% — trending-over-budget alert.
   *
   * Must be called with at least one subscriber; the same subscriber
   * list is used for both thresholds.
   *
   * @see https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html
   */
  withRecommendedThresholds(...subscribers: BudgetSubscriber[]): this {
    if (subscribers.length === 0) {
      throw new Error(
        `BudgetBuilder: withRecommendedThresholds(...) must be called with at least one subscriber.`,
      );
    }
    const { actualPercent, forecastedPercent } = BUDGET_DEFAULTS.recommendedThresholds;
    this.#notifications.push(
      { notificationType: "ACTUAL", threshold: actualPercent, subscribers },
      { notificationType: "FORECASTED", threshold: forecastedPercent, subscribers },
    );
    return this;
  }

  /**
   * Adds a custom CloudWatch alarm against the budget. The configure
   * callback receives a fresh {@link AlarmDefinitionBuilder} pre-set with
   * the alarm's key; configure metric, threshold, comparison and any
   * other options.
   *
   * Custom alarms are materialised in this builder's stack alongside any
   * recommended alarms. Like the recommended `EstimatedCharges` alarm,
   * custom alarms on `AWS/Billing` metrics will only fire when this
   * stack is in `us-east-1` — the builder emits the same synth-time
   * warning (`@composurecdk/budgets:alarm-region`) when used elsewhere.
   * For non-`us-east-1` stacks, route alarms via
   * {@link createBudgetAlarmBuilder} into a `us-east-1` stack.
   */
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<CfnBudget>) => AlarmDefinitionBuilder<CfnBudget>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<CfnBudget>(key)));
    return this;
  }

  build(scope: IConstruct, id: string, context: Record<string, object> = {}): BudgetBuilderResult {
    const { recommendedAlarms: alarmConfig, ...budgetProps } = this.props;

    const budgetType = budgetProps.budgetType ?? BUDGET_DEFAULTS.budgetType;
    const timeUnit = budgetProps.timeUnit ?? BUDGET_DEFAULTS.timeUnit;

    const requiresLimit = budgetType === "COST" || budgetType === "USAGE";
    if (requiresLimit && !budgetProps.limit) {
      throw new Error(
        `BudgetBuilder "${id}": limit({ amount, unit }) must be set for ${budgetType} budgets.`,
      );
    }

    const { notificationsWithSubscribers, snsTopics } = this.#buildNotifications(context);

    const budgetData: CfnBudget.BudgetDataProperty = {
      budgetName: budgetProps.budgetName,
      budgetType,
      timeUnit,
      ...(budgetProps.limit
        ? {
            budgetLimit: {
              amount: budgetProps.limit.amount,
              unit: budgetProps.limit.unit ?? BUDGET_DEFAULTS.limitUnit,
            },
          }
        : {}),
      ...(budgetProps.costFilters ? { costFilters: budgetProps.costFilters } : {}),
      ...(budgetProps.costTypes ? { costTypes: budgetProps.costTypes } : {}),
    };

    const cfnProps: CfnBudgetProps = {
      budget: budgetData,
      ...(notificationsWithSubscribers.length > 0 ? { notificationsWithSubscribers } : {}),
    };

    const budget = new CfnBudget(scope, id, cfnProps);

    const topicPolicies = createBudgetsTopicPolicies(scope, id, snsTopics);
    const alarms = buildBudgetAlarms(
      scope,
      id,
      { budget },
      {
        recommendedAlarms: alarmConfig,
        customAlarms: this.#customAlarms,
      },
    );

    return { budget, topicPolicies, alarms };
  }

  #addPercentageNotification(
    notificationType: NotificationType,
    thresholdPercent: number,
    subscribers: BudgetSubscriber[],
  ): this {
    if (subscribers.length === 0) {
      throw new Error(
        `BudgetBuilder: ${notificationType} notification at ${String(thresholdPercent)}% requires at least one subscriber.`,
      );
    }
    this.#notifications.push({ notificationType, threshold: thresholdPercent, subscribers });
    return this;
  }

  #buildNotifications(context: Record<string, object>): {
    notificationsWithSubscribers: CfnBudget.NotificationWithSubscribersProperty[];
    snsTopics: ITopic[];
  } {
    const notificationsWithSubscribers: CfnBudget.NotificationWithSubscribersProperty[] = [];
    const allSnsTopics: ITopic[] = [];

    for (const entry of this.#notifications) {
      const resolved = resolveSubscribers(entry.subscribers, context);
      notificationsWithSubscribers.push(toCfnNotificationWithSubscribers(entry, resolved.cfn));
      allSnsTopics.push(...resolved.snsTopics);
    }

    return { notificationsWithSubscribers, snsTopics: allSnsTopics };
  }
}

/**
 * Creates a new {@link IBudgetBuilder} for configuring an AWS Budget.
 */
export function createBudgetBuilder(): IBudgetBuilder {
  return Builder<BudgetBuilderProps, BudgetBuilder>(BudgetBuilder);
}
