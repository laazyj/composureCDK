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

## AlarmDefinition

The fully-resolved alarm descriptor consumed by `createAlarms`. All fields are required — this is the canonical form after defaults and overrides have been merged.

```ts
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
```
