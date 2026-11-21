# @composurecdk/cloudwatch

CloudWatch alarm primitives and the composite alarm builder for [ComposureCDK](../../README.md).

This package provides the building blocks for CloudWatch alarms that follow ComposureCDK's conventions: readable, stack-scoped alarm names, alarm actions routed across a whole app, and alarm definitions that a builder resolves at build time. It serves two audiences:

- **[App builders](#for-app-builders)**, who use ComposureCDK builders to define infrastructure.
- **[Builder-package authors](#for-builder-package-authors)**, who write builders that ship recommended alarms, whether in this repository or their own.

Everything this package exports is [public API](../../docs/architecture.md#public-api). It supplies the alarm mechanism (merging config, creating constructs, naming); which alarms a service gets, and their thresholds, belong to that service's package.

## Contents

| Export                                                                       | Purpose                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`alarmActionsPolicy`](#alarmactionspolicy)                                  | Route alarm actions (e.g. SNS) to every alarm in a scope       |
| [`alarmNamePolicy`](#alarmnamepolicy)                                        | Decorate or rewrite alarm names across a scope                 |
| [`alarmName`, `AlarmName`](#alarm-names)                                     | Validate an explicit alarm name                                |
| [`createCompositeAlarmBuilder`](#composite-alarms)                           | Build a composite alarm over other components' alarms          |
| [`AlarmDefinitionBuilder`](#custom-alarms)                                   | Define a custom alarm in an `addAlarm()` callback              |
| [`requireAlarms`](#requirealarms)                                            | Fail at synth when an alarm you depend on is absent            |
| [`AlarmConfigurer`](#alarm-sets)                                             | Type an `addAlarm()` callback, or a set of them                |
| [`AlarmConfig`, `AlarmConfigDefaults`](#alarmconfig-and-alarmconfigdefaults) | Type a recommended alarm's user overrides and its defaults     |
| [`resolveAlarmConfig`](#resolvealarmconfig)                                  | Merge user overrides onto defaults                             |
| [`resolveAlarmThresholdBasis`](#resolvealarmthresholdbasis)                  | Skip an alarm whose threshold derives from an unresolved token |
| [`AlarmDefinition`, `AlarmMetric`](#alarmdefinition)                         | The resolved alarm descriptor                                  |
| [`AlarmsOf`, `WithCustomAlarms`](#alarmsof)                                  | Type a builder result's `alarms` by key                        |
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

Every alarm a ComposureCDK builder creates gets an explicit, hierarchical name of the form `${stackName}/${path}/${kebab(id)}/${kebab(key)}` (e.g. `payments-prod/checkout-fn/errors`), instead of CloudFormation's default name with a random suffix. The console shows the slashes as a hierarchy, and kebab-cased segments read cleanly in dashboards, on-call pages and email subjects. [`defaultAlarmName`](./src/default-alarm-name.ts) builds it, including the nested-stack case.

`path` is the ids of the constructs between the stack and the builder's scope, and is empty for a builder built straight into the stack, as `compose()` does. It keeps two composites that each build a `queue` under their own construct (`…/orders/queue/…`, `…/refunds/queue/…`) from producing the same name, which CloudFormation rejects.

To name one alarm yourself, pass an `AlarmName` in its config. `alarmName()` checks a string against [CloudWatch's naming rules](./src/alarm-name.ts) and returns the branded `AlarmName` type. It trims surrounding whitespace and otherwise uses the value as written.

A name holding an unresolved CDK token (e.g. a `CfnParameter` value) is not validated, since its value is only known at deploy. The default name keeps such a segment verbatim rather than kebab-casing it, so the token still resolves.

```ts
import { alarmName } from "@composurecdk/cloudwatch";

createFunctionBuilder()
  // …
  .recommendedAlarms({ errors: { alarmName: alarmName("checkout/errors") } });
```

To change names across an app, use [alarmNamePolicy](#alarmnamepolicy) instead.

### Composite alarms

`createCompositeAlarmBuilder()` builds a [composite alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html): an alarm whose state is a rule over other alarms. Use one to give a deployment pipeline a single rollback alarm, or to page once for a system instead of once per symptom.

Its props are CDK's [`CompositeAlarmProps`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.CompositeAlarmProps.html). The build result is `{ alarm: CompositeAlarm }`. `alarmRule` is required, and it and `actionsSuppressor` accept a `Ref`, so the members can come from other components and the edges show in `compose()`. An `IAlarm` is itself an `IAlarmRule`, so CDK's `AlarmRule` combinators (`anyOf`, `allOf`, `not`, `fromAlarm(alarm, state)`) take member alarms directly. To combine alarms from several components, [`combine`](../../docs/architecture.md#combining-refs--one-consumer-many-dependencies) their refs. A recommended alarm is typed `Alarm | undefined` ([AlarmsOf](#alarmsof)), so pass the members through [`requireAlarms`](#requirealarms): a member that is disabled then fails at synth rather than silently dropping out of the rule.

```ts
import { combine, compose, ref } from "@composurecdk/core";
import {
  createCompositeAlarmBuilder,
  requireAlarms,
  type WithCustomAlarms,
} from "@composurecdk/cloudwatch";
import { AlarmRule } from "aws-cdk-lib/aws-cloudwatch";

compose(
  {
    fold: createFunctionBuilder() /* … */
      .addAlarm("stateStale", (a) => a /* … */),
    dlq: createQueueBuilder("dlq") /* … */,
    rollback: createCompositeAlarmBuilder()
      .alarmDescription("A deploy may have broken the fold: roll it back.")
      .alarmRule(
        combine(
          {
            errors: ref("fold", (r: FunctionBuilderResult) => r.alarms.errors),
            stale: ref(
              "fold",
              (r: WithCustomAlarms<FunctionBuilderResult, "stateStale">) => r.alarms.stateStale,
            ),
            dlq: ref("dlq", (r: QueueBuilderResult) => r.alarms.approximateNumberOfMessagesVisible),
          },
          (m) => AlarmRule.anyOf(...Object.values(requireAlarms(m))),
        ),
      ),
  },
  { fold: [], dlq: [], rollback: ["fold", "dlq"] },
);
```

The default name follows the [library convention](#alarm-names) without a key, `${stackName}/${path}/${kebab(id)}` (here `my-stack/rollback`). It is a plain string, not a token, so a pipeline can derive the alarm's ARN from it. To name it yourself, pass `compositeAlarmName(alarmName("…"))`. Both policies apply to composite alarms, and their `singleOnly` / `compositeOnly` rules let you notify on the composite and leave its members quiet, which is how AWS recommends using composites to reduce alarm noise.

A composite can only watch alarms in its own account and region; CDK fails at synthesis on a member from another environment. CloudFront and Route 53 alarms live in `us-east-1` whatever the resource's region ([ADR-0004](../../docs/adr/0004-split-alarm-builder-for-fixed-region-metrics.md)), so build a composite over them into the `us-east-1` alarm stack.

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

#### Alarm sets

Every builder with `addAlarm` also has `addAlarms(alarms)`, which takes a record of callbacks and adds each one under its key, exactly as one `addAlarm(key, configure)` call per entry would. Use it to keep a component's alarm set in one step of the chain. `AlarmConfigurer<T>` types the callbacks:

```ts
import type { AlarmConfigurer } from "@composurecdk/cloudwatch";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";

function processorAlarms(): Record<string, AlarmConfigurer<LambdaFunction>> {
  return {
    highInvocations: (alarm) => alarm.metric((fn) => fn.metricInvocations()).threshold(1000),
    noInvocations: (alarm) =>
      alarm
        .metric((fn) => fn.metricInvocations())
        .threshold(0)
        .lessThanOrEqual(),
  };
}

createFunctionBuilder()
  // …
  .addAlarms(processorAlarms());
```

Alarms are added in the record's iteration order. JavaScript iterates integer-like keys (`"500"`) first, in numeric order, so give such alarms a word key (`"status500"`) if the order matters.

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

### requireAlarms

A builder result types each recommended alarm as `Alarm | undefined`, because you can disable it and some depend on configuration ([AlarmsOf](#alarmsof)). Where another component depends on an alarm, such as a member of a rollback composite alarm, an absent one is a defect. `requireAlarms(record)` returns the record with every alarm typed as present, and throws at synth naming any key that is `undefined`:

```ts
import { combine, ref } from "@composurecdk/core";
import { requireAlarms, type WithCustomAlarms } from "@composurecdk/cloudwatch";
import { AlarmRule } from "aws-cdk-lib/aws-cloudwatch";

combine(
  {
    stale: ref("fold", (r: WithCustomAlarms<FunctionBuilderResult, "stale">) => r.alarms.stale),
    dlq: ref("dlq", (r: QueueBuilderResult) => r.alarms.approximateNumberOfMessagesVisible),
  },
  (m) => AlarmRule.anyOf(...Object.values(requireAlarms(m))),
);
```

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

### AlarmsOf

`AlarmsOf<Recommended>` is the type of a builder result's `alarms`. Each recommended key is optional, because the alarm can be disabled, depend on configuration, or be skipped by `resolveAlarmThresholdBasis`. Any other key is a compile error.

`WithCustomAlarms<Result, Custom>` adds custom alarm keys to a result from outside, each typed `Alarm`, because `addAlarm` always creates its alarm. A builder's `build()` returns `WithCustomAlarms<…, string>`, which accepts any key ([ADR-0021](../../docs/adr/0021-alarm-keys-typed-on-the-result.md) explains both choices):

```ts
import type { AlarmsOf, WithCustomAlarms } from "@composurecdk/cloudwatch";

export type WidgetAlarmKey = "errors" | `${string}Backlog`;

export interface WidgetBuilderResult {
  widget: Widget;
  alarms: AlarmsOf<WidgetAlarmKey>;
}

class WidgetBuilder implements Lifecycle<WithCustomAlarms<WidgetBuilderResult, string>> {
  build(scope: IConstruct, id: string): WithCustomAlarms<WidgetBuilderResult, string> {
    // createAlarms' Record<string, Alarm> is assignable as it is.
  }
}

// A consumer reads a custom alarm by naming its key:
ref("widget", (r: WithCustomAlarms<WidgetBuilderResult, "highLoad">) => r.alarms.highLoad);
```

List the keys the builder really creates, which are not always the config keys. A key derived from another key (`${source}Backlog`) is a template-literal pattern.

### defaultAlarmName

`defaultAlarmName(scope, id, key?)` returns the [default alarm name](#alarm-names) that `createAlarms` uses; without a key, the name ends at `kebab(id)`. Call it to give an alarm you create yourself, such as a `CompositeAlarm`, a name that matches the rest.

### constraints

`constraints.validate.alarmName` checks a string against CloudWatch's alarm-name rules and throws if it fails. Every ComposureCDK package exports its AWS-property checks in this `constraints.validate` / `constraints.sanitize` shape; see [Constraints](../../docs/constraints.md). Most code wants `alarmName()`, which runs the same check and returns an `AlarmName`.
