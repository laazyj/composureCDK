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

_Coming in a follow-up commit in this PR — `lambdaTarget`, `sqsTarget`, `snsTarget`, `sfnStateMachineTarget`, `eventBusTarget`, `cloudWatchLogGroupTarget`._
