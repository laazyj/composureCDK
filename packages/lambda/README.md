# @composurecdk/lambda

Lambda builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for AWS Lambda functions with secure, AWS-recommended defaults. It wraps the CDK [Function](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.Function.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Function Builder

```ts
import { createFunctionBuilder } from "@composurecdk/lambda";

const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .build(stack, "MyFunction");
```

Every [FunctionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createFunctionBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property        | Default  | Rationale                                                                            |
| --------------- | -------- | ------------------------------------------------------------------------------------ |
| `tracing`       | `ACTIVE` | Enables X-Ray distributed tracing for observability.                                 |
| `loggingFormat` | `JSON`   | Structured logs for CloudWatch Logs Insights auto-discovery and consistent querying. |

These defaults are guided by the [AWS Well-Architected Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html).

The defaults are exported as `FUNCTION_DEFAULTS` for visibility and testing:

```ts
import { FUNCTION_DEFAULTS } from "@composurecdk/lambda";
```

### Overriding defaults

```ts
import { LoggingFormat, Tracing } from "aws-cdk-lib/aws-lambda";

const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .tracing(Tracing.PASS_THROUGH)
  .loggingFormat(LoggingFormat.TEXT)
  .build(stack, "MyFunction");
```

## Execution role

By default, `createFunctionBuilder` creates an explicit IAM execution role with an inline `LogsWriter` policy scoped to the function's auto-created log group:

- `logs:CreateLogStream` and `logs:PutLogEvents` on the function's specific log group ARN.
- No `logs:CreateLogGroup` (the builder pre-creates the group).
- No `AWSLambdaBasicExecutionRole` managed policy — that policy grants the same actions on `*`, allowing a compromised function to write to any log group in the account.

The role is exposed on the build result:

```ts
const result = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .build(stack, "MyFunction");

result.role; // IRole — the execution role attached to the function
```

CDK continues to layer X-Ray, VPC, KMS-env, DLQ, and EFS permissions onto the role automatically based on the function's other props.

### Extending the default role: `.configureRole(fn)`

For least-privilege grants alongside the defaults:

```ts
import { createStatementBuilder } from "@composurecdk/iam";

const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .configureRole((role) =>
    role.addInlinePolicyStatements("OrdersRead", [
      createStatementBuilder()
        .allow()
        .actions(["dynamodb:GetItem", "dynamodb:Query"])
        .resources([table.tableArn]),
    ]),
  );
```

The callback receives the internal [`IRoleBuilder`](../iam/README.md). Calling `configureRole` more than once replaces the previous callback. The reserved `LogsWriter` name throws at build time if added a second time.

### Supplying a role: `.role(role)`

For a fully external role. The builder skips creating its own role and **does not** auto-attach the `LogsWriter` policy — the caller takes responsibility for permissions. Accepts a concrete `IRole` or a `ref(...)` for cross-component wiring under `compose`:

```ts
import { compose, ref } from "@composurecdk/core";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";

compose(
  {
    sharedRole: createServiceRoleBuilder("lambda.amazonaws.com"),
    handler: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(Code.fromAsset("lambda"))
      .role(ref("sharedRole", (r: RoleBuilderResult) => r.role)),
  },
  { sharedRole: [], handler: ["sharedRole"] },
).build(stack, "MySystem");
```

### Escape hatch: `.useCdkAutoRole()`

Opt back into CDK's auto-created role attached to `AWSLambdaBasicExecutionRole`. Not the recommended path — it re-introduces the wildcard log surface — but available for matching an existing stack's logical IDs during a phased migration.

`.role()`, `.configureRole()`, and `.useCdkAutoRole()` are mutually exclusive; combining any two throws at build time.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Lambda) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm                  | Metric                            | Default threshold           | Created when                          |
| ---------------------- | --------------------------------- | --------------------------- | ------------------------------------- |
| `errors`               | Errors (Sum, 1 min)               | > 0                         | Always                                |
| `throttles`            | Throttles (Sum, 1 min)            | > 0                         | Always                                |
| `duration`             | Duration (p99, 1 min)             | > 90% of configured timeout | `timeout` is set                      |
| `concurrentExecutions` | ConcurrentExecutions (Max, 1 min) | >= 80% of reserved limit    | `reservedConcurrentExecutions` is set |

The defaults are exported as `FUNCTION_ALARM_DEFAULTS` for visibility and testing:

```ts
import { FUNCTION_ALARM_DEFAULTS } from "@composurecdk/lambda";
```

The `duration` and `concurrentExecutions` alarms use percentage-based thresholds that automatically adjust when the base value changes. For example, if you change the function timeout from 30s to 60s, the duration alarm threshold adjusts from 27s to 54s without any configuration change.

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

Absolute-threshold alarms (`errors`, `throttles`) accept a `threshold` value:

```ts
const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .recommendedAlarms({
    errors: { threshold: 5, evaluationPeriods: 3, datapointsToAlarm: 2 },
  });
```

Percentage-based alarms (`duration`, `concurrentExecutions`) accept a `thresholdPercent` between 0 and 1:

```ts
builder.timeout(Duration.seconds(30)).recommendedAlarms({
  duration: { thresholdPercent: 0.75 }, // 75% of timeout = 22.5s
});
```

For a fixed absolute threshold, disable the recommended alarm and add a custom one via `addAlarm`.

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ errors: false, throttles: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to the Lambda function, so the metric factory has access to the function's built-in metric helpers.

```ts
const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .timeout(Duration.seconds(30))
  .addAlarm("highInvocations", (alarm) =>
    alarm
      .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
      .threshold(1000)
      .greaterThanOrEqual()
      .description("Invocation count is unusually high"),
  );
```

Custom alarm keys must not conflict with recommended alarm keys. To replace a recommended alarm, disable it first and add a custom one with the same key.

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = handler.build(stack, "MyFunction");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## Examples

- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with recommended alarms, custom alarms, and SNS alarm actions
- [ExplicitRoleStack](../examples/src/explicit-role-app.ts) — `.configureRole(...)` extending the default execution role with a least-privilege S3 grant
- [MultiStackApp](../examples/src/multi-stack-app.ts) — Lambda split across stacks via `.withStacks()`, wired with `ref`
