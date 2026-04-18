/**
 * Well-architected defaults for {@link createBudgetBuilder}. Each can be
 * overridden via the builder's fluent API.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html
 */
export const BUDGET_DEFAULTS = {
  /**
   * Default budget type — most budgets are cost budgets.
   *
   * @see https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Budget.html
   */
  budgetType: "COST" as const,

  /**
   * Default tracking period — monthly is the most common granularity and
   * aligns with AWS billing cycles.
   *
   * @see https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create.html
   */
  timeUnit: "MONTHLY" as const,

  /**
   * Default spend currency — most customers need to set this; the builder
   * defaults to USD to align with the AWS Billing reporting default.
   *
   * @see https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Spend.html
   */
  limitUnit: "USD",

  /**
   * Recommended percentage thresholds applied by
   * {@link IBudgetBuilder.withRecommendedThresholds}.
   *
   * - `ACTUAL` at 80% — early warning before you breach the budget.
   * - `FORECASTED` at 100% — notifies when forecasted spend trends over
   *   budget for the period.
   *
   * @see https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html
   */
  recommendedThresholds: {
    actualPercent: 80,
    forecastedPercent: 100,
  },
};
