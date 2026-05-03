# @composurecdk/budgets

AWS Budgets builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for `AWS::Budgets::Budget` with well-architected defaults, percentage-threshold notification helpers, and automatic `AWS::SNS::TopicPolicy` wiring for SNS subscribers. It wraps the CDK L1 [CfnBudget](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_budgets.CfnBudget.html) construct — there is no L2 for Budgets.

## Budget Builder

```ts
import { createBudgetBuilder, email } from "@composurecdk/budgets";

const budget = createBudgetBuilder()
  .budgetName("AgentBudget")
  .limit({ amount: 50 })
  .notifyOnActual(100, { emails: [email("ops@example.com")] })
  .build(stack, "AgentBudget");
```

### Properties

Every field on [CfnBudget.BudgetDataProperty](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_budgets.CfnBudget.BudgetDataProperty.html) that tends to be set by hand is surfaced as a fluent setter:

| Setter              | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `budgetName(name)`  | `BudgetName` — stable identifier in the console and across regions.   |
| `budgetType(type)`  | `BudgetType` — `COST`, `USAGE`, `RI_UTILIZATION`, `RI_COVERAGE`, etc. |
| `timeUnit(unit)`    | `TimeUnit` — `DAILY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`.             |
| `limit({ amount })` | `BudgetLimit` — required for `COST` and `USAGE` budgets.              |
| `costFilters(map)`  | `CostFilters` — e.g. `{ Service: ["AmazonEC2"] }`.                    |
| `costTypes(types)`  | `CostTypes` passthrough.                                              |

### Notifications

Each notification takes a `NotifySubscribers` object with **at most one** `sns` topic and a list of validated `emails` — AWS Budgets caps every notification at 1 SNS subscriber plus up to 10 EMAIL subscribers. The shape encodes that constraint in the type system: passing two SNS topics is unrepresentable.

```ts
import { email } from "@composurecdk/budgets";

createBudgetBuilder()
  .limit({ amount: 100 })
  .notifyOnActual(80, { emails: [email("ops@example.com")] }) // 80% ACTUAL → email
  .notifyOnForecasted(100, { sns: ref("alerts", (r) => r.topic) }) // 100% FORECASTED → SNS topic
  .notifyOnActual(100, {
    sns: killSwitchTopic,
    emails: [email("oncall@example.com")],
  }) // hard breach → automation + human
  .addNotification({
    notificationType: "ACTUAL",
    threshold: 120,
    thresholdType: "ABSOLUTE_VALUE",
    subscribers: { emails: [email("oncall@example.com")] },
  });
```

Email addresses must be constructed via `email(string)`, which validates and brands the value — bare strings are rejected at compile time. The `sns` slot accepts an `ITopic` instance or a `Resolvable<ITopic>` reference to a topic owned by a sibling component.

### Recommended Thresholds

```ts
createBudgetBuilder()
  .limit({ amount: 50 })
  .withRecommendedThresholds({ emails: [email("ops@example.com")] });
```

Applies the AWS Cost Optimization pillar defaults: `ACTUAL` at 80% and `FORECASTED` at 100%.

### Currency

`limit({ amount, unit })` validates `unit` against the AWS-Budgets-supported ISO 4217 set (`DEFAULT_BUDGET_CURRENCIES`). Typos like `"ZZZ"` throw at synth instead of mid-deploy. Because the synth context cannot see an account's billing currency, anything other than `"USD"` also emits a non-fatal warning (`@composurecdk/budgets:limit-currency`) — verify the configured unit matches your billing currency before deploying.

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

The created `TopicPolicy` constructs are returned on `result.topicPolicies`, keyed by the topic's fully-qualified node path (unique within the CDK app).

## Recommended Alarms

AWS Budgets does not publish per-budget CloudWatch metrics, but the well-architected cost-monitoring pattern combines a budget with a CloudWatch alarm on `AWS/Billing EstimatedCharges`. The builder can create that alarm for you, but it is **off by default** — pass an `estimatedCharges` config to opt in.

| Alarm              | Metric                              | Default behaviour |
| ------------------ | ----------------------------------- | ----------------- |
| `estimatedCharges` | EstimatedCharges (Maximum, 6 hours) | off               |

`treatMissingData` defaults to `notBreaching`: missing datapoints from a quiet account are not treated as a breach.

```ts
const stack = new Stack(app, "BillingStack", { env: { region: "us-east-1" } });

createBudgetBuilder()
  .limit({ amount: 50 })
  .recommendedAlarms({
    estimatedCharges: { threshold: 50, currency: "USD" },
  })
  .build(stack, "AccountBudget");
```

The Budget itself is a global service and can be created from any region; only the alarm requires `us-east-1` (see below).

### Customising thresholds

```ts
createBudgetBuilder()
  .limit({ amount: 1000 })
  .recommendedAlarms({
    estimatedCharges: {
      threshold: 1000,
      currency: "USD",
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
    },
  });
```

### Disabling alarms

Disable the recommended alarm with `recommendedAlarms({ estimatedCharges: false })`, or disable all recommended alarms with `recommendedAlarms(false)`. Custom alarms attached via `addAlarm` are unaffected by either form.

### Custom alarms

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

createBudgetBuilder()
  .limit({ amount: 1000 })
  .addAlarm("ec2EstimatedCharges", (a) =>
    a
      .metric(
        () =>
          new Metric({
            namespace: "AWS/Billing",
            metricName: "EstimatedCharges",
            dimensionsMap: { Currency: "USD", ServiceName: "AmazonEC2" },
            statistic: "Maximum",
          }),
      )
      .threshold(500)
      .greaterThan()
      .description("EC2 estimated charges exceeded $500."),
  );
```

### Applying alarm actions

No alarm actions are configured by default. Wire SNS or other actions via [`alarmActionsPolicy`](../cloudwatch/README.md#alarm-actions-policy) (or an `afterBuild` hook) — for cross-region deployments, the policy applied to the `us-east-1` monitoring stack covers both recommended and custom alarms.

### Cross-region: `AWS/Billing EstimatedCharges` lives in `us-east-1` only

The `AWS/Billing EstimatedCharges` metric is emitted in `us-east-1` only, regardless of where your budgets and resources live. CloudWatch alarms are regional, so an alarm in any other region will never receive data. The combined builder emits a synth-time warning (`@composurecdk/budgets:alarm-region`) when used outside `us-east-1`, but the better approach is to route the alarm into a `us-east-1` stack via `createBudgetAlarmBuilder` and `compose().withStacks()`:

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createBudgetBuilder,
  createBudgetAlarmBuilder,
  type BudgetBuilderResult,
} from "@composurecdk/budgets";

compose(
  {
    account: createBudgetBuilder()
      .budgetName("Account")
      .limit({ amount: 1000 })
      .recommendedAlarms(false), // suppress alarms in the budget's own stack

    accountAlarms: createBudgetAlarmBuilder()
      .budget(ref<BudgetBuilderResult>("account"))
      .recommendedAlarms({ estimatedCharges: { threshold: 1000, currency: "USD" } }),
  },
  { account: [], accountAlarms: ["account"] },
)
  .withStacks({
    account: appStack, //         any region — AWS::Budgets::Budget is global
    accountAlarms: monitoringStack, // us-east-1 — where AWS/Billing metrics live
  })
  .build(app, "App");
```

If your custom `addAlarm` definitions reference the budget construct, set `crossRegionReferences: true` on both stacks so CDK can export the budget's properties from the app stack and import them in the alarm stack. The same pattern is documented for CloudFront and Route 53 alarms, and codified in [ADR-0004](../../docs/adr/0004-split-alarm-builder-for-fixed-region-metrics.md).

## Build Result

```ts
interface BudgetBuilderResult {
  budget: CfnBudget;
  topicPolicies: Record<string, TopicPolicy>;
  alarms: Record<string, Alarm>;
}
```
