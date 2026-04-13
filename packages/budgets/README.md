# @composurecdk/budgets

AWS Budgets builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for `AWS::Budgets::Budget` with well-architected defaults, percentage-threshold notification helpers, and automatic `AWS::SNS::TopicPolicy` wiring for SNS subscribers. It wraps the CDK L1 [CfnBudget](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_budgets.CfnBudget.html) construct — there is no L2 for Budgets.

## Budget Builder

```ts
import { createBudgetBuilder } from "@composurecdk/budgets";

const budget = createBudgetBuilder()
  .budgetName("AgentBudget")
  .limit({ amount: 50, unit: "GBP" })
  .notifyOnActual(100, "ops@example.com")
  .build(stack, "AgentBudget");
```

### Properties

Every field on [CfnBudget.BudgetDataProperty](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_budgets.CfnBudget.BudgetDataProperty.html) that tends to be set by hand is surfaced as a fluent setter:

| Setter               | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `budgetName(name)`   | `BudgetName` — stable identifier in the console and across regions.        |
| `budgetType(type)`   | `BudgetType` — `COST`, `USAGE`, `RI_UTILIZATION`, `RI_COVERAGE`, etc.      |
| `timeUnit(unit)`     | `TimeUnit` — `DAILY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`.                  |
| `limit({ amount })`  | `BudgetLimit` — required for `COST` and `USAGE` budgets.                   |
| `costFilters(map)`   | `CostFilters` — e.g. `{ Service: ["AmazonEC2"] }`.                         |
| `costTypes(types)`   | `CostTypes` passthrough.                                                   |
| `billingAccountId()` | Account that owns the budget (payer-account member-budget scenarios only). |

### Notifications

Percentage-threshold helpers cover the common case; `addNotification` accepts the raw shape when you need absolute-value thresholds or a different comparison operator.

```ts
createBudgetBuilder()
  .limit({ amount: 100 })
  .notifyOnActual(80, "ops@example.com") // 80% ACTUAL → email
  .notifyOnForecasted(
    100,
    ref("alerts", (r) => r.topic),
  ) // 100% FORECASTED → SNS topic
  .addNotification({
    notificationType: "ACTUAL",
    thresholdPercent: 120,
    thresholdType: "ABSOLUTE_VALUE",
    subscribers: ["oncall@example.com"],
  });
```

Subscribers may be email strings, `ITopic` instances, or `Resolvable<ITopic>` references to topics owned by sibling components.

### Recommended Thresholds

```ts
createBudgetBuilder().limit({ amount: 50 }).withRecommendedThresholds("ops@example.com");
```

Applies the AWS Cost Optimization pillar defaults: `ACTUAL` at 80% and `FORECASTED` at 100%.

## Defaults

| Property                                  | Default     | Rationale                                                                     |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `budgetType`                              | `"COST"`    | Cost budgets are the most common; usage/RI/SP budgets are explicit overrides. |
| `timeUnit`                                | `"MONTHLY"` | Aligns with AWS billing cycles.                                               |
| `limitUnit`                               | `"USD"`     | Matches the AWS Billing console default.                                      |
| `recommendedThresholds.actualPercent`     | `80`        | Early-warning threshold before breach.                                        |
| `recommendedThresholds.forecastedPercent` | `100`       | Trending-over-budget alert for the period.                                    |

Exported as `BUDGET_DEFAULTS`.

## Automatic SNS Topic Policies

When at least one notification subscriber is an SNS topic, the builder creates a matching `AWS::SNS::TopicPolicy` granting `SNS:Publish` to the `budgets.amazonaws.com` service principal. Without that policy, budget notifications to SNS silently fail to deliver — one of the most common footguns when wiring Budgets by hand.

The created `TopicPolicy` constructs are returned on `result.topicPolicies`, keyed by the topic's node id.

## Recommended Alarms

AWS Budgets does not publish per-budget CloudWatch metrics, but the well-architected cost-monitoring pattern combines a budget with a CloudWatch alarm on `AWS/Billing EstimatedCharges`. The builder can create that alarm for you:

```ts
createBudgetBuilder()
  .limit({ amount: 50 })
  .recommendedAlarms({
    estimatedCharges: { threshold: 50, currency: "USD" },
  });
```

`EstimatedCharges` is only emitted in `us-east-1`, so this alarm must be synthesised into a stack deployed to that region. Off by default — callers opt in explicitly.

## Build Result

```ts
interface BudgetBuilderResult {
  budget: CfnBudget;
  topicPolicies: Record<string, TopicPolicy>;
  alarms: Record<string, Alarm>;
}
```
