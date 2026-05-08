# @composurecdk/events

EventBridge rule builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for EventBridge rules with secure, AWS-recommended defaults. It wraps the CDK [Rule](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.Rule.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Rule Builder

```ts
import { createRuleBuilder } from "@composurecdk/events";
import { Schedule } from "aws-cdk-lib/aws-events";
import { Duration } from "aws-cdk-lib";

const rule = createRuleBuilder()
  .schedule(Schedule.rate(Duration.minutes(15)))
  .description("Idle stopper")
  .build(stack, "IdleStopperSchedule");
```

Every [RuleProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.RuleProps.html) property is available as a fluent setter on the builder. The builder requires at least one of `schedule` or `eventPattern` to be set — an EventBridge rule with neither is inert.

`Schedule` and `Match` (used for event-pattern matching) are imported directly from `aws-cdk-lib/aws-events` — this package does not re-export them, matching the convention used elsewhere in the library (e.g. `Runtime` from `aws-cdk-lib/aws-lambda`).

### Cross-component event bus

The `eventBus` property accepts a `Resolvable<IEventBus>` so the rule can attach to a custom bus built by another component:

```ts
import { compose, ref } from "@composurecdk/core";

compose(
  {
    bus: customEventBus,
    rule: createRuleBuilder()
      .eventBus(ref("bus", (r) => r.eventBus))
      .eventPattern({ source: ["my.app"] }),
  },
  { bus: [], rule: ["bus"] },
);
```

When omitted, the rule attaches to the account default bus, matching CDK's `RuleProps.eventBus` default.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#EventBridge) by default. No alarm actions are configured — access alarms from the build result, or use the `alarmActionsPolicy` from `@composurecdk/cloudwatch` to wire them to an SNS topic in one place.

| Alarm                            | Metric                                      | Default threshold | Created when |
| -------------------------------- | ------------------------------------------- | ----------------- | ------------ |
| `failedInvocations`              | FailedInvocations (Sum, 1 min)              | > 0               | Always       |
| `throttledRules`                 | ThrottledRules (Sum, 1 min)                 | > 0               | Always       |
| `invocationsSentToDlq`           | InvocationsSentToDlq (Sum, 1 min)           | > 0               | Always[^dlq] |
| `invocationsFailedToBeSentToDlq` | InvocationsFailedToBeSentToDlq (Sum, 1 min) | > 0               | Always[^dlq] |

[^dlq]: The DLQ metrics only emit data when at least one target on the rule has a `deadLetterQueue` configured and EventBridge attempts redrive. `TreatMissingData` defaults to `notBreaching`, so the alarm stays quiet on rules without DLQs. Attach a DLQ via the matching target helper's `deadLetterQueue` option — see [Cross-component DLQ wiring](#cross-component-dlq-wiring) below, and the [EventBridge DLQ docs](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html).

The defaults are exported as `RULE_ALARM_DEFAULTS` for visibility and testing:

```ts
import { RULE_ALARM_DEFAULTS } from "@composurecdk/events";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const rule = createRuleBuilder()
  .eventPattern({ source: ["my.app"] })
  .recommendedAlarms({
    failedInvocations: { threshold: 5, evaluationPeriods: 3 },
  });
```

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ throttledRules: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `IRule`, so the metric factory has access to the rule's properties. The Serverless Lens flags `RetryInvocationAttempts` as an early indicator of an undersized target — a good candidate for `addAlarm`:

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Duration } from "aws-cdk-lib";

createRuleBuilder()
  .eventPattern({ source: ["my.app"] })
  .addAlarm("retryAttempts", (alarm) =>
    alarm
      .metric(
        (rule) =>
          new Metric({
            namespace: "AWS/Events",
            metricName: "RetryInvocationAttempts",
            dimensionsMap: { RuleName: rule.ruleName },
            statistic: "Sum",
            period: Duration.minutes(1),
          }),
      )
      .threshold(10)
      .greaterThan()
      .description("Target is being undersized; retries are climbing."),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = rule.build(stack, "MyRule");

for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

Or apply them stack-wide via `alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(alertTopic)] } })` from `@composurecdk/cloudwatch` — same pattern used by the rest of the library, so a single SNS topic can fan out to function and rule alarms together.

## Adding Targets

Targets are registered via `addTarget(key, target)`, where `target` is a CDK [`IRuleTarget`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.IRuleTarget.html) (or a `Resolvable<IRuleTarget>` for cross-component wiring). Each target is exposed on `result.targets` under its key.

```ts
import { createRuleBuilder } from "@composurecdk/events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";

const result = createRuleBuilder()
  .schedule(Schedule.rate(Duration.minutes(15)))
  .addTarget("stopper", new LambdaFunction(idleStopperFn))
  .build(stack, "IdleStopperSchedule");

result.targets.stopper; // IRuleTarget
```

For cross-component wiring inside a [`compose`](../core/README.md) system, pass a `ref` and use the matching target helper from this package (see [Target Helpers](#target-helpers) below):

```ts
import { compose, ref } from "@composurecdk/core";
import { createRuleBuilder, lambdaTarget } from "@composurecdk/events";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";

const system = compose(
  {
    stopper: createFunctionBuilder()./* ... */,
    idleStopperSchedule: createRuleBuilder()
      .schedule(Schedule.rate(Duration.minutes(15)))
      .addTarget(
        "stopper",
        lambdaTarget(ref("stopper", (r: FunctionBuilderResult) => r.function)),
      ),
  },
  { stopper: [], idleStopperSchedule: ["stopper"] },
);
```

## Target Helpers

This package ships small free-function helpers that wrap the corresponding [`aws-events-targets`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events_targets-readme.html) constructs and accept a `Resolvable<I*>` for the underlying resource. Use them inside `addTarget` instead of constructing the CDK target classes directly — they make cross-component wiring with `ref(...)` work without an `afterBuild` hook.

| Helper                     | Wraps                | Underlying resource |
| -------------------------- | -------------------- | ------------------- |
| `lambdaTarget`             | `LambdaFunction`     | `IFunction`         |
| `sqsTarget`                | `SqsQueue`           | `IQueue`            |
| `snsTarget`                | `SnsTopic`           | `ITopic`            |
| `sfnStateMachineTarget`    | `SfnStateMachine`    | `IStateMachine`     |
| `eventBusTarget`           | `EventBus`           | `IEventBus`         |
| `cloudWatchLogGroupTarget` | `CloudWatchLogGroup` | `ILogGroup`         |

The second argument is the matching CDK target props type (`LambdaFunctionProps`, `SqsQueueProps`, …) — refer to the CDK docs for available options. Common ones include `deadLetterQueue` (concrete `IQueue`), `retryAttempts`, `maxEventAge`, and target-specific input transforms (`event` / `input` / `message`).

Other CDK target types (API Gateway, ECS task, Batch job, Kinesis, Firehose, AppSync, …) are not yet wrapped — pass them inline as a regular `IRuleTarget` until a wrapper helper lands.

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createRuleBuilder,
  lambdaTarget,
  sqsTarget,
} from "@composurecdk/events";
import {
  createFunctionBuilder,
  type FunctionBuilderResult,
} from "@composurecdk/lambda";

compose(
  {
    handler: createFunctionBuilder()./* ... */,
    rule: createRuleBuilder()
      .eventPattern({ source: ["aws.s3"], detailType: ["Object Created"] })
      .addTarget(
        "primary",
        lambdaTarget(ref("handler", (r: FunctionBuilderResult) => r.function), {
          retryAttempts: 2,
        }),
      ),
  },
  { handler: [], rule: ["handler"] },
);
```

### Cross-component DLQ wiring

Each helper takes a single `Resolvable` for its primary resource. Secondary props such as `deadLetterQueue` accept the concrete CDK type (`IQueue` for most targets). When the DLQ is also a sibling-component output, construct the helper inside `ref().map()` and have the dependency component expose both the resource and the queue:

```ts
.addTarget(
  "stopper",
  ref<{ fn: IFunction; dlq: IQueue }>(
    "stopperBundle",
    (b) => lambdaTarget(b.fn, { deadLetterQueue: b.dlq }),
  ),
)
```

A dedicated DLQ component (`createQueueBuilder`-style) — and helpers that accept `Resolvable<IQueue>` for the DLQ directly — are out of scope for this PR; track as a follow-up if a use case emerges.
