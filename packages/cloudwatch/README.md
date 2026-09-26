# @composurecdk/cloudwatch

CloudWatch alarm primitives for [ComposureCDK](../../README.md).

This package provides the building blocks for CloudWatch alarms that follow ComposureCDK's conventions: readable, stack-scoped alarm names, alarm actions routed across a whole app, and alarm definitions that a builder resolves at build time. It serves two audiences:

- **[App builders](#for-app-builders)**, who use ComposureCDK builders to define infrastructure.
- **[Builder-package authors](#for-builder-package-authors)**, who write builders that ship recommended alarms, whether in this repository or their own.

Everything this package exports is public API. It is not a place for code that ComposureCDK's own packages happen to share: new exports must clear [the bar below](#adding-an-export).

## Contents

| Export                                                                       | Purpose                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`alarmActionsPolicy`](#alarmactionspolicy)                                  | Route alarm actions (e.g. SNS) to every alarm in a scope       |
| [`alarmNamePolicy`](#alarmnamepolicy)                                        | Decorate or rewrite alarm names across a scope                 |
| [`alarmName`, `AlarmName`](#alarm-names)                                     | Validate an explicit alarm name                                |
| [`AlarmDefinitionBuilder`](#custom-alarms)                                   | Define a custom alarm in an `addAlarm()` callback              |
| [`AlarmConfig`, `AlarmConfigDefaults`](#alarmconfig-and-alarmconfigdefaults) | Type a recommended alarm's user overrides and its defaults     |
| [`resolveAlarmConfig`](#resolvealarmconfig)                                  | Merge user overrides onto defaults                             |
| [`resolveAlarmThresholdBasis`](#resolvealarmthresholdbasis)                  | Skip an alarm whose threshold derives from an unresolved token |
| [`AlarmDefinition`, `AlarmMetric`](#alarmdefinition)                         | The resolved alarm descriptor                                  |
| [`createAlarms`](#createalarms)                                              | Create `Alarm` constructs from definitions                     |
| [`defaultAlarmName`](#defaultalarmname)                                      | The default name, for an alarm created outside `createAlarms`  |
| [`constraints`](#constraints)                                                | The alarm-name validator, in the shape every package exports   |

The config, option and result types of these exports are exported too, so you can name them in your own code.

## For app builders

Most alarms come from a resource package: a builder's `recommendedAlarms` creates them and `addAlarm` adds your own (see, for example, [`@composurecdk/lambda`](../lambda/README.md)). The exports below tune those alarms. The two policies also apply to alarms created any other way.

### alarmActionsPolicy

A [Policy](../../docs/adr/0002-policies.md) that routes CloudWatch alarm actions (e.g. SNS notifications) to every `Alarm` and `CompositeAlarm` in a construct subtree. Install it once on an `App` or `Stack` and it applies to every alarm the subtree produces, including alarms created later by builders or nested composed systems.

```ts
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";

alarmActionsPolicy(app, {
  defaults: { alarmActions: [new SnsAction(alertsTopic)] },
});
```

The policy is a CDK [Aspect](https://docs.aws.amazon.com/cdk/v2/guide/aspects.html), so it works in any CDK app and runs during synthesis. You can call it before or after the alarms it targets are created, and it does not need to be wrapped in `afterBuild`. The one constraint: any `IAlarmAction` in the config (e.g. `new SnsAction(topic)`) must reference constructs that already exist when you call it.

Express per-alarm routing as rules. A matcher can be a substring (tested against both the alarm's `id` and `path`), a `RegExp` (tested against `path`), or a predicate that receives the full match context. A rule's actions are added to the `defaults`; set `replaceDefaults: true` on a rule to drop the defaults for the alarms it matches.

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

#### Per-scope routing: different topics for different stacks

Rules route by _alarm identity_ (id, path, predicate). To route by _scope_ instead, for example one SNS topic for everything in `us-east-1` and another for the primary region, call `alarmActionsPolicy` once per target scope. If the composed system builds the topics itself, this is the case that needs [`afterBuild`](../core/README.md): its closure receives the build `results`, so each call can reference its topic.

```ts
compose({ usEast1Alerts: createTopicBuilder(), siteAlerts: createTopicBuilder() }, {/* … */})
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

#### Limitation: L2 alarms only

The policy covers only L2 `Alarm` and `CompositeAlarm` constructs. It skips bare `CfnAlarm` / `CfnCompositeAlarm` nodes (created without the L2 wrapper) without warning. ComposureCDK's alarm builders and aws-cdk-lib's own L2 APIs always create the wrapper, so this is rare. If you write L1 alarms by hand, attach their actions yourself.

### alarmNamePolicy

A [Policy](../../docs/adr/0002-policies.md) that decorates CloudWatch alarm names. Like `alarmActionsPolicy`, it applies to every alarm in the subtree it is installed on.

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

For each alarm, the policy reads the existing name ([the default](#alarm-names) or a per-alarm override), applies `defaults.prefix` / `defaults.suffix`, then applies each matching rule in declaration order. It validates the result with `alarmName()` and writes it back to the CloudFormation resource.

Rules support `prefix`, `suffix`, and `transform`. `transform` builds a new name from scratch and takes precedence over `prefix` and `suffix` on the same rule. Set `replaceDefaults: true` on a rule to skip the `defaults` decoration for the alarms it matches.

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

Matchers work as they do in `alarmActionsPolicy`. `singleOnly` / `compositeOnly` limit a rule to one kind of alarm.

The separator between the `prefix`, the current name and the `suffix` defaults to `-`; pass `separator` to change it.

#### Limitation: token-valued names

If an alarm's name is an unresolved CDK token that does not resolve to a string at synthesis, the policy skips that alarm and leaves its name unchanged. Every alarm that ComposureCDK builders (and aws-cdk-lib's L2 `Alarm`) create has a resolvable string name, so this is rare.

### Alarm names

Every alarm a ComposureCDK builder creates gets an explicit, hierarchical name of the form `${stackName}/${kebab(id)}/${kebab(key)}` (e.g. `payments-prod/checkout-fn/errors`), instead of CloudFormation's default name with a random suffix. The console shows the slashes as a hierarchy, and kebab-cased segments read cleanly in dashboards, on-call pages and email subjects. [`defaultAlarmName`](./src/default-alarm-name.ts) builds it, including the nested-stack case.

To name one alarm yourself, pass an `AlarmName` in its config. `alarmName()` checks a string against [CloudWatch's naming rules](./src/alarm-name.ts) and returns the branded `AlarmName` type. It trims surrounding whitespace and otherwise uses the value as written.

```ts
import { alarmName } from "@composurecdk/cloudwatch";

createFunctionBuilder()
  // …
  .recommendedAlarms({ errors: { alarmName: alarmName("checkout/errors") } });
```

To change names across an app, use [alarmNamePolicy](#alarmnamepolicy) instead.

### Custom alarms

A builder's `addAlarm(key, configure)` passes you an `AlarmDefinitionBuilder`, typed to the construct the builder creates. The metric factory runs at build time against that construct, so it can use the construct's own metric helpers.

```ts
import { Duration } from "aws-cdk-lib";

createFunctionBuilder()
  // …
  .addAlarm("highInvocations", (alarm) =>
    alarm
      .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
      .threshold(1000)
      .greaterThanOrEqual()
      .evaluationPeriods(3)
      .datapointsToAlarm(2)
      .description("Invocation count is unusually high"),
  );
```

`description` also accepts a function of the resolved definition:

```ts
alarm.description((def) => `Alert when invocations >= ${def.threshold} per minute`);
```

The other methods are `alarmName`, `constructId` (see [Construct IDs](#construct-ids)), `greaterThan`, `lessThan`, `lessThanOrEqual` and `treatMissingData`.

#### Rate and ratio alarms

The metric factory may return either a `Metric` or a `MathExpression` (the exported `AlarmMetric` type), so a rate or ratio alarm is defined the same way:

```ts
import { Duration } from "aws-cdk-lib";
import { MathExpression, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";

alarm
  // Guard the denominator: CloudWatch drops a divide-by-zero data point, which
  // would push the alarm into INSUFFICIENT_DATA whenever there are no invocations.
  .metric(
    (fn) =>
      new MathExpression({
        expression: "IF(invocations > 0, errors / invocations, 0)",
        usingMetrics: {
          errors: fn.metricErrors(),
          invocations: fn.metricInvocations(),
        },
        // Set the period on the expression. It overrides the period of every
        // metric in usingMetrics, and defaults to 5 minutes.
        period: Duration.minutes(1),
      }),
  )
  .threshold(0.05)
  .greaterThanOrEqual()
  .treatMissingData(TreatMissingData.NOT_BREACHING);
```

CloudWatch can alarm only on an expression that returns a single time series. It rejects a `MathExpression` that uses `SEARCH(...)`, or otherwise returns several series, at deploy time.

## For builder-package authors

A builder that ships recommended alarms follows the same four steps:

1. Declare a config interface with one `AlarmConfig | false` entry per recommended alarm, and a defaults constant typed with `AlarmConfigDefaults`.
2. At build time, merge the user's config onto the defaults with `resolveAlarmConfig`.
3. Turn each resolved config into an `AlarmDefinition`, and resolve any `addAlarm()` builders against the construct.
4. Pass all the definitions to `createAlarms`.

[`@composurecdk/sqs`](../sqs/src/queue-alarms.ts) and [`@composurecdk/lambda`](../lambda/src/function-alarms.ts) are complete examples. If the service publishes its metrics in one fixed region whatever the resource's region, as CloudFront and Route 53 do, also follow [ADR-0004](../../docs/adr/0004-split-alarm-builder-for-fixed-region-metrics.md).

### AlarmConfig and AlarmConfigDefaults

`AlarmConfig` is the type a user passes to override one recommended alarm. Every field is optional, so a user can change the threshold without restating the rest. `AlarmConfigDefaults` is the type of your package's defaults: every tunable field set, and no `alarmName`, because names are derived for each alarm.

```ts
import type { AlarmConfig, AlarmConfigDefaults } from "@composurecdk/cloudwatch";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";

export interface WidgetAlarmConfig {
  enabled?: boolean;
  errors?: AlarmConfig | false;
}

export const WIDGET_ALARM_DEFAULTS = {
  errors: {
    threshold: 0,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  },
} satisfies Record<"errors", AlarmConfigDefaults>;
```

### resolveAlarmConfig

Merges a user's `AlarmConfig` onto your defaults and returns a `ResolvedAlarmConfig`: every field set, plus the user's `alarmName` if they gave one. Check the user's opt-outs first, so no work is done for alarms they turned off.

```ts
import { resolveAlarmConfig } from "@composurecdk/cloudwatch";

if (config?.enabled === false) return [];

if (config?.errors !== false) {
  const cfg = resolveAlarmConfig(config?.errors, WIDGET_ALARM_DEFAULTS.errors);
  definitions.push({
    key: "errors",
    alarmName: cfg.alarmName,
    metric: widget.metricErrors(),
    threshold: cfg.threshold,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: cfg.evaluationPeriods,
    datapointsToAlarm: cfg.datapointsToAlarm,
    treatMissingData: cfg.treatMissingData,
    description: `Widget errors > ${String(cfg.threshold)}`,
  });
}
```

### resolveAlarmThresholdBasis

Some recommended alarms derive their threshold from another input, such as a percentage of a timeout. When that input is an unresolved token (for example, a `CfnParameter`), there is no number to derive a threshold from at synthesis. `resolveAlarmThresholdBasis` returns the number when it can be known. Otherwise it returns `undefined` and adds a standard warning to `scope`, which users can acknowledge by `warningId`. If the input was not set at all, it returns `undefined` without a warning.

```ts
import { resolveAlarmThresholdBasis } from "@composurecdk/cloudwatch";

// Check the opt-out first: the warning would tell the user to do what they already did.
if (config?.latency !== false) {
  const timeoutMs = resolveAlarmThresholdBasis({
    scope: widget,
    value: props.timeout,
    isUnresolved: (timeout) => timeout.isUnresolved(),
    resolve: (timeout) => timeout.toMilliseconds(),
    warningId: "@acme/widget:token-timeout-latency-alarm",
    alarmLabel: "widget latency",
    suppressHint: "recommendedAlarms({ latency: false })",
  });
  if (timeoutMs !== undefined) {
    // create the alarm with a threshold derived from timeoutMs
  }
}
```

`isUnresolved` defaults to `Token.isUnresolved`. Override it for a type that reports its own token state, such as `Duration`.

### AlarmDefinition

The fully-resolved alarm descriptor that `createAlarms` consumes. Every field is required except `alarmName` and `constructId`, which `createAlarms` fills in when they are omitted.

`AlarmDefinitionBuilder` produces one from a deferred metric factory: construct it with the alarm's key, and call `resolve(construct)` at build time.

```ts
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";

const builder = new AlarmDefinitionBuilder<IWidget>("highLoad");
configure(builder); // the user's addAlarm() callback
const definition = builder.resolve(widget);
```

### createAlarms

Creates a CDK [Alarm](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html) for each `AlarmDefinition` and returns them as a `Record<string, Alarm>` keyed by each definition's key. It throws if two definitions share a key.

```ts
import { createAlarms } from "@composurecdk/cloudwatch";

const alarms = createAlarms(scope, "MyFunction", definitions);
// alarms.errors, alarms.throttles, etc.
```

Each alarm is named with `def.alarmName` if set, and with [defaultAlarmName](#defaultalarmname) otherwise.

#### Construct IDs

Each alarm's construct ID is `${id}${Capitalize(key)}Alarm` (e.g. `MyFunctionErrorsAlarm`). Set `constructId` on a definition to use a different ID verbatim:

```ts
const alarms = createAlarms(scope, "MyFunction", [
  { key: "errors", constructId: "LegacyErrorsAlarm" /* …rest of the definition */ },
]);
```

Use this to adopt alarms that are already deployed. The construct ID becomes the CloudFormation logical ID, and changing the logical ID replaces the alarm (deletes and recreates it) on the next deploy.

### defaultAlarmName

`defaultAlarmName(scope, id, key)` returns the [default alarm name](#alarm-names) that `createAlarms` uses. Call it to give an alarm you create yourself, such as a `CompositeAlarm`, a name that matches the rest.

### constraints

`constraints.validate.alarmName` checks a string against CloudWatch's alarm-name rules and throws if it fails. Every ComposureCDK package exports its AWS-property checks in this `constraints.validate` / `constraints.sanitize` shape; see [Constraints](../../docs/constraints.md). Most code wants `alarmName()`, which runs the same check and returns an `AlarmName`.

## Adding an export

Every export is a promise to every user of the package: once published, it can change only in a major version. A new export must meet both conditions:

1. **It is a primitive, not an opinion.** Mechanism that any alarm needs, such as merging config, creating constructs or naming, qualifies. Choices about what to alarm on, which thresholds or evaluation windows to use, or which alarms a family of services should share are opinions. They belong in the package that holds them.
2. **It has a use outside this repository, or it has settled into the same shape in at least three packages.**

Until both hold, keep the code in the package that needs it. If a second package needs the same code, copy it. Duplicated code can change freely; a public export cannot.
