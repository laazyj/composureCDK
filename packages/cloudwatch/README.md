# @composurecdk/cloudwatch

CloudWatch alarm primitives for [ComposureCDK](../../README.md).

This package provides the shared types and utilities that ComposureCDK resource packages use to create CloudWatch alarms. It separates generic alarm machinery from resource-specific alarm definitions, so the same primitives can be reused across `@composurecdk/lambda` and future resource packages.

Most users interact with alarms through a resource package (e.g., `@composurecdk/lambda`'s `recommendedAlarms` and `addAlarm`). Use this package directly when building custom alarm definitions or creating a new ComposureCDK resource package.

## AlarmConfig

Partial override type for tuning alarm thresholds without replacing the entire alarm configuration. Resource packages use this as the user-facing knob for recommended alarms.

```ts
import type { AlarmConfig } from "@composurecdk/cloudwatch";

const overrides: AlarmConfig = {
  threshold: 5,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
};
```

## AlarmDefinitionBuilder

Fluent builder for constructing deferred alarm definitions. The metric factory is stored at configuration time and resolved later against a concrete construct during `build()`.

```ts
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";

const builder = new AlarmDefinitionBuilder<LambdaFunction>("highInvocations")
  .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
  .threshold(1000)
  .greaterThanOrEqual()
  .evaluationPeriods(3)
  .datapointsToAlarm(2)
  .description("Invocation count is unusually high");

// Later, during build:
const definition = builder.resolve(lambdaFunction);
```

The `description` method also accepts a factory for contextual descriptions:

```ts
builder.description((def) => `Alert when invocations >= ${def.threshold} per minute`);
```

## createAlarms

Factory function that creates CDK [Alarm](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html) constructs from fully-resolved `AlarmDefinition`s. Returns a `Record<string, Alarm>` keyed by each definition's key.

```ts
import { createAlarms } from "@composurecdk/cloudwatch";

const alarms = createAlarms(scope, "MyFunction", definitions);
// alarms.errors, alarms.throttles, etc.
```

Construct IDs follow the pattern `${id}${Capitalize(key)}Alarm` (e.g., `MyFunctionErrorsAlarm`).

## alarmActionsPolicy

A [Policy](../../docs/adr/0002-policies.md) that routes CloudWatch alarm actions (e.g. SNS notifications) to every `Alarm` and `CompositeAlarm` in a construct subtree. Install it once on an `App` or `Stack` and it applies to every alarm the subtree produces — including alarms created later by builders or nested composed systems.

```ts
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";

alarmActionsPolicy(app, {
  defaults: { alarmActions: [new SnsAction(alertsTopic)] },
});
```

Per-alarm routing is expressed as rules. Matchers can be a substring (tested against both the alarm's `id` and `path`), a `RegExp` (tested against `path`), or a predicate receiving the full match context. Rules append actions on top of `defaults`; set `replaceDefaults: true` on a rule to suppress defaults for its matched alarms.

```ts
alarmActionsPolicy(app, {
  defaults: { alarmActions: [new SnsAction(standardTopic)] },
  rules: [
    { match: "HighSev", alarmActions: [new SnsAction(pagerTopic)] },
    { match: /Composite$/, compositeOnly: true, alarmActions: [new SnsAction(execTopic)] },
  ],
});
```

All three action states are supported: `alarmActions`, `okActions`, and `insufficientDataActions`.

The policy is implemented as a CDK [Aspect](https://docs.aws.amazon.com/cdk/v2/guide/aspects.html) — it has no dependency on `@composurecdk/core` and works in any CDK app. Because aspects fire during synth, the policy can be registered before or after the alarms it targets. The only constraint is that any `IAlarmAction` instances in the config (e.g. `new SnsAction(topic)`) must reference constructs that already exist when the policy is called.

### Limitation: L2 alarms only

Only L2 `Alarm` and `CompositeAlarm` constructs are covered. Bare `CfnAlarm` / `CfnCompositeAlarm` nodes (created directly without the L2 wrapper) are silently skipped. In practice this is rare — the ComposureCDK alarm builders and aws-cdk-lib's own L2 APIs always create the wrapper — but if you hand-write L1 alarms, actions must be attached manually.

## AlarmDefinition

The fully-resolved alarm descriptor consumed by `createAlarms`. All fields are required — this is the canonical form after defaults and overrides have been merged.

```ts
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
```
