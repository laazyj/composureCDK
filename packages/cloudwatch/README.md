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

### Rate and ratio alarms

The metric factory may return either a `Metric` or a `MathExpression` (the
exported `AlarmMetric` union), so rate/ratio alarms share the same definition
shape:

```ts
import { MathExpression } from "aws-cdk-lib/aws-cloudwatch";

new AlarmDefinitionBuilder<LambdaFunction>("errorRate")
  // Guard the denominator: a divide-by-zero data point is dropped, which would
  // otherwise push the alarm into INSUFFICIENT_DATA when there are no invocations.
  .metric(
    (fn) =>
      new MathExpression({
        expression: "IF(invocations > 0, errors / invocations, 0)",
        usingMetrics: {
          errors: fn.metricErrors(),
          invocations: fn.metricInvocations(),
        },
        // Set the period on the expression — it overrides the period of every
        // metric in usingMetrics (default 5 minutes otherwise).
        period: Duration.minutes(1),
      }),
  )
  .threshold(0.05)
  .greaterThanOrEqual()
  .treatMissingData(TreatMissingData.NOT_BREACHING);
```

Only single-time-series expressions can be alarmed: a `MathExpression` whose
expression uses `SEARCH(...)` (or otherwise returns multiple series) is rejected
by CloudWatch at deploy time.

## createAlarms

Factory function that creates CDK [Alarm](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html) constructs from fully-resolved `AlarmDefinition`s. Returns a `Record<string, Alarm>` keyed by each definition's key.

```ts
import { createAlarms } from "@composurecdk/cloudwatch";

const alarms = createAlarms(scope, "MyFunction", definitions);
// alarms.errors, alarms.throttles, etc.
```

Construct IDs follow the pattern `${id}${Capitalize(key)}Alarm` (e.g., `MyFunctionErrorsAlarm`).

### Construct IDs

Set `constructId` on a definition to override that pattern — the value is used verbatim:

```ts
const alarms = createAlarms(scope, "MyFunction", [
  { key: "errors", constructId: "LegacyErrorsAlarm" /* …rest of the definition */ },
]);
```

This exists for grandfathering: a CloudFormation logical ID is derived from the construct ID, and changing it replaces (drops + recreates) the alarm on deploy. Pinning `constructId` to the existing ID lets you adopt `createAlarms` for alarms already in a deployed stack without churn. Unlike the alarm _name_ — which can be rewritten at synth time by [alarmNamePolicy](#alarmnamepolicy) — the construct ID is fixed at construction, so it can only be set here, per definition. `AlarmDefinitionBuilder` exposes the same control via `.constructId(id)`.

### Alarm names

Each alarm receives an explicit, hierarchical name of the form `${stackName}/${kebab(id)}/${kebab(key)}` (e.g. `payments-prod/checkout-fn/errors`) instead of CloudFormation's hash-suffixed default. Slashes render hierarchy in the console; segments are kebab-cased so names scan cleanly in dashboards, oncall pages, and email subjects, where word separation matters more than in code.

Per-alarm overrides go through [`alarmName()`][alarm-name-src] — a validating constructor for the branded [`AlarmName`][alarm-name-src] type — and cross-cutting decoration through [alarmNamePolicy](#alarmnamepolicy). The default fallback lives in [`defaultAlarmName`][default-alarm-name-src].

[alarm-name-src]: ./src/alarm-name.ts
[default-alarm-name-src]: ./src/default-alarm-name.ts

## alarmNamePolicy

A [Policy](../../docs/adr/0002-policies.md) that decorates CloudWatch alarm names across an entire scope. Mirrors the shape of `alarmActionsPolicy` — install it once on an `App` or `Stack` and it applies to every alarm the subtree produces, including alarms created later by builders or nested composed systems.

```ts
import { alarmNamePolicy } from "@composurecdk/cloudwatch";

alarmNamePolicy(app, {
  defaults: { prefix: "prod" },
  rules: [
    { match: /Errors$/, suffix: "critical" },
    { match: "throttles", suffix: "warning" },
    { match: (ctx) => ctx.path.includes("payments"), prefix: "payments" },
  ],
});
```

For each alarm the policy reads the existing name (from `defaultAlarmName` or a per-alarm override), applies `defaults.prefix` / `defaults.suffix`, then layers each matching rule in declaration order. The result is validated via `alarmName()` and written back to the CFN resource.

Rules support `prefix`, `suffix`, and `transform`. `transform` produces a new name from scratch and wins over `prefix`/`suffix` on the same rule. `replaceDefaults: true` on a matched rule suppresses the `defaults` decoration for that alarm.

```ts
alarmNamePolicy(app, {
  defaults: { prefix: "prod" },
  rules: [
    { match: "team-x", prefix: "team-x", replaceDefaults: true },
    {
      match: /payments/,
      transform: (ctx) => alarmName(`payments/${ctx.id}`),
    },
  ],
});
```

Matchers use the same shape as `alarmActionsPolicy`: substring (tested against both `id` and `path`), `RegExp` (tested against `path`), or a predicate receiving the full match context. `singleOnly` / `compositeOnly` scope rules to one alarm kind.

The separator between `prefix` / current-name / `suffix` segments defaults to `-`; pass `separator` to override.

### Limitation: L1 reads only

The policy reads `cfn.alarmName` and writes the decorated value back. If a name is set as an unresolved CDK token that doesn't resolve to a string at synth time, the alarm is skipped and the original name is left in place. In practice every alarm produced by ComposureCDK builders (and aws-cdk-lib's L2 `Alarm`) sets a resolvable string, so this is rare.

## alarmActionsPolicy

A [Policy](../../docs/adr/0002-policies.md) that routes CloudWatch alarm actions (e.g. SNS notifications) to every `Alarm` and `CompositeAlarm` in a construct subtree. Install it once on an `App` or `Stack` and it applies to every alarm the subtree produces — including alarms created later by builders or nested composed systems.

```ts
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";

alarmActionsPolicy(app, {
  defaults: { alarmActions: [new SnsAction(alertsTopic)] },
});
```

The policy is implemented as a CDK [Aspect](https://docs.aws.amazon.com/cdk/v2/guide/aspects.html) — it has no dependency on `@composurecdk/core` and works in any CDK app. Because aspects fire during synth, the policy can be registered before or after the alarms it targets, and there is **no need to wrap the call in `afterBuild`** — calling `alarmActionsPolicy(app, …)` at app scope outside any `compose()` chain is the recommended shape. The only constraint is that any `IAlarmAction` instances in the config (e.g. `new SnsAction(topic)`) must reference constructs that already exist when the policy is called.

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

### Per-scope routing: different topics for different stacks

Rules route by _alarm identity_ (id, path, predicate). When you instead need to route by _scope_ — e.g. one SNS topic for everything in `us-east-1` and another for the primary region — call `alarmActionsPolicy` multiple times, once per target scope. If the topics are themselves built by the composed system, this is the case where wrapping in [`afterBuild`](../core/README.md) is load-bearing: the closure captures the build `results` so each call can reference its topic.

```ts
compose(
  { usEast1Alerts: createTopicBuilder(), siteAlerts: createTopicBuilder() },
  {
    /* … */
  },
)
  .withStacks({ usEast1Alerts: usEast1AlertsStack, siteAlerts: siteStack })
  .afterBuild((_scope, _id, results) => {
    alarmActionsPolicy(usEast1AlertsStack, {
      defaults: { alarmActions: [new SnsAction(results.usEast1Alerts.topic)] },
    });
    alarmActionsPolicy(siteStack, {
      defaults: { alarmActions: [new SnsAction(results.siteAlerts.topic)] },
    });
  })
  .build(app, "MySystem");
```

If a _single_ topic covers the whole app, prefer the top-level form above — `afterBuild` adds nothing in that case.

### Limitation: L2 alarms only

Only L2 `Alarm` and `CompositeAlarm` constructs are covered. Bare `CfnAlarm` / `CfnCompositeAlarm` nodes (created directly without the L2 wrapper) are silently skipped. In practice this is rare — the ComposureCDK alarm builders and aws-cdk-lib's own L2 APIs always create the wrapper — but if you hand-write L1 alarms, actions must be attached manually.

## AlarmDefinition

The fully-resolved alarm descriptor consumed by `createAlarms`. All fields are required — this is the canonical form after defaults and overrides have been merged.

```ts
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
```
