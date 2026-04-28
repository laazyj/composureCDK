import { type CfnBudget } from "aws-cdk-lib/aws-budgets";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Annotations, Stack, Token } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import { AlarmDefinitionBuilder, createAlarms } from "@composurecdk/cloudwatch";
import type { BudgetAlarmConfig } from "./alarm-config.js";
import { resolveBudgetAlarmDefinitions } from "./budget-alarms.js";
import type { BudgetBuilderResult } from "./budget-builder.js";

/**
 * Configuration properties for {@link createBudgetAlarmBuilder}.
 *
 * The standalone alarm builder mirrors the alarm surface that
 * {@link createBudgetBuilder} creates by default. It exists so that
 * billing alarms can be created in a different stack from the budget
 * itself — specifically a `us-east-1` stack, since the
 * `AWS/Billing EstimatedCharges` metric is only emitted in `us-east-1`
 * regardless of where the budget is deployed.
 *
 * @see ADR-0004 — Split-alarm builder pattern for fixed-region metrics
 */
export interface BudgetAlarmBuilderProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * Mirrors {@link BudgetBuilderProps.recommendedAlarms}. Off by default —
   * pass an {@link BudgetAlarmConfig.estimatedCharges} entry to enable
   * the account-level billing alarm. Set to `false` to suppress recommended
   * alarms entirely; custom alarms added via
   * {@link IBudgetAlarmBuilder.addAlarm} are unaffected.
   *
   * No alarm actions are configured by default. Use `alarmActionsPolicy`
   * (or an `afterBuild` hook) to wire SNS or other actions onto the
   * resulting alarms.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
   */
  recommendedAlarms?: BudgetAlarmConfig | false;
}

/**
 * The build output of an {@link IBudgetAlarmBuilder}.
 */
export interface BudgetAlarmBuilderResult {
  /**
   * The CloudWatch alarms created by this builder, keyed by alarm name.
   * Uses the same key scheme as {@link BudgetBuilderResult.alarms}.
   */
  alarms: Record<string, Alarm>;
}

/**
 * A fluent builder for budget-related CloudWatch alarms, decoupled from
 * the budget itself. Use this when the budget lives in a stack outside
 * `us-east-1` — route this builder's component into a `us-east-1` stack
 * via `compose().withStacks()` so the alarms land where the
 * `AWS/Billing EstimatedCharges` metric actually emits.
 *
 * @see {@link createBudgetAlarmBuilder}
 */
export type IBudgetAlarmBuilder = IBuilder<BudgetAlarmBuilderProps, BudgetAlarmBuilder>;

/**
 * The `AWS/Billing EstimatedCharges` metric is emitted in `us-east-1`
 * only. CloudWatch alarms are regional, so alarms created in any other
 * region will never receive data. Warn (don't error) when alarms are
 * being created outside `us-east-1`, unless the region is an unresolved
 * token (env-agnostic stack — user knows best).
 */
function warnIfNotUsEast1(scope: IConstruct): void {
  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) return;
  if (region === "us-east-1") return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/budgets:alarm-region",
    `AWS/Billing EstimatedCharges is emitted in us-east-1 only, but this stack is ` +
      `deployed in "${region}". CloudWatch alarms created here will not fire. Deploy the ` +
      `stack in us-east-1, or use createBudgetAlarmBuilder() routed to a ` +
      `us-east-1 stack via compose().withStacks().`,
  );
}

/**
 * Shared alarm-assembly used by both {@link createBudgetBuilder} (in its
 * own stack) and {@link createBudgetAlarmBuilder} (typically in a separate
 * `us-east-1` stack). Materialises the recommended billing alarm and any
 * user-supplied custom alarms, emits the region warning if the resulting
 * scope is not in `us-east-1`, and creates the alarm constructs.
 *
 * The `target.budget` reference is only needed for custom alarms added
 * via `addAlarm()` — the recommended `EstimatedCharges` alarm is
 * account-level and does not key off the budget itself, so `target` may
 * be omitted when only the recommended alarm is being created.
 *
 * @internal
 */
export function buildBudgetAlarms(
  scope: IConstruct,
  id: string,
  target: Pick<BudgetBuilderResult, "budget"> | undefined,
  options: {
    recommendedAlarms?: BudgetAlarmConfig | false;
    customAlarms?: AlarmDefinitionBuilder<CfnBudget>[];
  } = {},
): Record<string, Alarm> {
  const recommended = options.recommendedAlarms;
  const recommendedDefs: AlarmDefinition[] =
    recommended === false ? [] : resolveBudgetAlarmDefinitions(recommended);

  const customAlarms = options.customAlarms ?? [];
  if (customAlarms.length > 0 && !target) {
    throw new Error(
      `BudgetAlarmBuilder "${id}" was given addAlarm() definitions but no budget. ` +
        `Call .budget() with a BudgetBuilderResult or a Ref to one before adding custom alarms.`,
    );
  }
  const customAlarmDefs = target ? customAlarms.map((b) => b.resolve(target.budget)) : [];
  const allAlarmDefs = [...recommendedDefs, ...customAlarmDefs];

  if (allAlarmDefs.length > 0) {
    warnIfNotUsEast1(scope);
  }

  return createAlarms(scope, id, allAlarmDefs);
}

class BudgetAlarmBuilder implements Lifecycle<BudgetAlarmBuilderResult> {
  props: Partial<BudgetAlarmBuilderProps> = {};
  #budget?: Resolvable<BudgetBuilderResult>;
  readonly #customAlarms: AlarmDefinitionBuilder<CfnBudget>[] = [];

  /**
   * Sets the budget to alarm on. Pass the result of
   * {@link createBudgetBuilder} (or a {@link Ref} to it). The builder
   * reads the underlying `CfnBudget` from the result so custom alarms
   * added via {@link addAlarm} can reference it.
   *
   * Optional when only the recommended `EstimatedCharges` alarm is being
   * created — that alarm is account-level and does not reference any
   * specific budget. Required as soon as you call {@link addAlarm}.
   *
   * Pair with `compose().withStacks()` to route this component into a
   * `us-east-1` stack while the budget itself lives elsewhere — set
   * `crossRegionReferences: true` on both stacks so CDK can wire any
   * cross-stack references automatically.
   */
  budget(budget: Resolvable<BudgetBuilderResult>): this {
    this.#budget = budget;
    return this;
  }

  /**
   * Adds a custom alarm against the budget. The configure callback
   * receives a fresh {@link AlarmDefinitionBuilder} pre-set with the
   * alarm's key; configure metric, threshold, comparison and any other
   * options.
   *
   * The created alarm is materialised in this builder's stack — useful
   * for cross-region setups where you want all billing-related alarms to
   * live with the recommended one.
   */
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<CfnBudget>) => AlarmDefinitionBuilder<CfnBudget>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<CfnBudget>(key)));
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): BudgetAlarmBuilderResult {
    const target = this.#budget ? resolve(this.#budget, context ?? {}) : undefined;
    return {
      alarms: buildBudgetAlarms(scope, id, target, {
        recommendedAlarms: this.props.recommendedAlarms,
        customAlarms: this.#customAlarms,
      }),
    };
  }
}

/**
 * Creates a new {@link IBudgetAlarmBuilder} for materialising AWS Budget
 * alarms in a stack separate from the budget itself.
 *
 * The recommended use is multi-region deployments: the budget lives in
 * the application's stack (in any region — `AWS::Budgets::Budget` is a
 * global resource), and the alarms must live in a `us-east-1` stack so
 * they can read the `AWS/Billing EstimatedCharges` metric AWS emits
 * there.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     account: createBudgetBuilder()
 *       .budgetName("Account")
 *       .limit({ amount: 1000 })
 *       .recommendedAlarms(false),                       // suppress alarms in the budget's own stack
 *
 *     accountAlarms: createBudgetAlarmBuilder()
 *       .budget(ref<BudgetBuilderResult>("account"))
 *       .recommendedAlarms({
 *         estimatedCharges: { threshold: 1000, currency: "USD" },
 *       }),
 *   },
 *   { account: [], accountAlarms: ["account"] },
 * )
 *   .withStacks({
 *     account:       appStack,         // any region — Budgets is a global service
 *     accountAlarms: monitoringStack,  // us-east-1 — where AWS/Billing metrics live
 *   })
 *   .build(app, "App");
 * ```
 *
 * Set `crossRegionReferences: true` on both stacks if you reference the
 * budget from custom alarms via `.addAlarm()`.
 */
export function createBudgetAlarmBuilder(): IBudgetAlarmBuilder {
  return Builder<BudgetAlarmBuilderProps, BudgetAlarmBuilder>(BudgetAlarmBuilder);
}
