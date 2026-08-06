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

| Alarm                    | Metric                            | Default threshold           | Created when                           |
| ------------------------ | --------------------------------- | --------------------------- | -------------------------------------- |
| `errors`                 | Errors (Sum, 1 min)               | > 0                         | Always                                 |
| `throttles`              | Throttles (Sum, 1 min)            | > 0                         | Always                                 |
| `duration`               | Duration (p99, 1 min)             | > 90% of configured timeout | `timeout` is set                       |
| `concurrentExecutions`   | ConcurrentExecutions (Max, 1 min) | >= 80% of reserved limit    | `reservedConcurrentExecutions` is set  |
| `<key>FailedInvocations` | FailedInvokeEventCount (Sum)      | > 0                         | An SQS or DynamoDB source is attached  |
| `<key>DroppedEvents`     | DroppedEventCount (Sum)           | > 0                         | An SQS or DynamoDB source is attached  |
| `iteratorAge`            | IteratorAge (Max, 1 min)          | > 60000 ms for 3 min¹       | A stream source (DynamoDB) is attached |

¹ AWS recommends alarming on `IteratorAge` for stream consumers but prescribes no fixed threshold — it is workload dependent. The 60s/3-minute default is deliberately conservative; tune it per workload via `eventSourceIteratorAge`.

The per-mapping event-source alarms are contextual: one pair is created per event source attached via `addEventSource` (see [Event sources](#event-sources)) whose kind emits per-mapping ESM metrics. Each alarm's key is the event source's key suffixed with `FailedInvocations` / `DroppedEvents` — e.g. an event source added as `"orders"` produces `ordersFailedInvocations` and `ordersDroppedEvents`. The `eventSourceFailedInvocations` / `eventSourceDroppedEvents` fields on `recommendedAlarms` tune every such alarm.

`iteratorAge` is different: `IteratorAge` is a function-level metric, so a single alarm (keyed `iteratorAge`) is created whenever at least one stream source (currently DynamoDB streams) is attached, regardless of how many. It warns when the consumer falls behind its stream. Tune or disable it via the `eventSourceIteratorAge` field on `recommendedAlarms`.

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

## Event sources

`addEventSource(key, source)` wires a queue or stream to the function. A Lambda
function can have many event sources of mixed types, so the hook is repeatable
and keyed — the resolved sources are exposed on `result.eventSources`.

Pass a `ComposureEventSource` from a factory (`sqsEventSource`,
`dynamoEventSource`), which carries its own `Resolvable` so the source queue or
table can be a `ref()` to a sibling component, or a bare CDK `IEventSource` as
an escape hatch.

```ts
import { compose, ref } from "@composurecdk/core";
import { createFunctionBuilder, sqsEventSource } from "@composurecdk/lambda";
import { createQueueBuilder } from "@composurecdk/sqs";

const system = compose(
  {
    orders: createQueueBuilder().queueName("orders"),
    processor: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(Code.fromAsset("lambda"))
      .addEventSource("orders", sqsEventSource(ref("orders", (r) => r.queue))),
  },
  { orders: [], processor: ["orders"] },
);
```

The source is attached _after_ the function and its least-privilege execution
role exist, so the `source.bind(fn)` that `addEventSource` performs grants the
consume permission (SQS `ReceiveMessage`, or DynamoDB `grantStreamRead`) onto
the builder's role rather than CDK's auto-role.

`dynamoEventSource(table, props?)` mirrors the SQS factory for DynamoDB streams.
The table must have a stream enabled (via the [DynamoDB builder](../dynamodb)'s
`.dynamoStream(...)` / `.stream(...)`, or `TableProps.stream`); otherwise CDK
throws `DynamoDB Streams must be enabled` at build time. `startingPosition`
defaults to `LATEST` and is overridable via `props`:

```ts
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { compose, ref } from "@composurecdk/core";
import { createFunctionBuilder, dynamoEventSource } from "@composurecdk/lambda";
import { createTableV2Builder } from "@composurecdk/dynamodb";

compose(
  {
    orders: createTableV2Builder()
      .partitionKey({ name: "pk", type: AttributeType.STRING })
      .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES),
    processor: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(Code.fromAsset("lambda"))
      .addEventSource(
        "orders",
        dynamoEventSource(
          ref("orders", (r) => r.table),
          {
            startingPosition: StartingPosition.TRIM_HORIZON,
          },
        ),
      ),
  },
  { orders: [], processor: ["orders"] },
);
```

### Secure defaults

`sqsEventSource` applies AWS-recommended defaults, each overridable via the
second `props` argument and exported as `DEFAULT_SQS_EVENT_SOURCE_PROPS`:

| Property                  | Default                     | Rationale                                                                                          |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `reportBatchItemFailures` | `true`                      | A single poison message fails only its own record, not the whole batch. CDK defaults this `false`. |
| `metricsConfig`           | `{ metrics: [EventCount] }` | Enables the per-mapping ESM metrics that back the event-source contextual alarms.                  |

`dynamoEventSource` applies the same defaults plus `startingPosition` and
`bisectBatchOnError`, exported as `DEFAULT_DYNAMO_EVENT_SOURCE_PROPS` (the shared
`DEFAULT_STREAM_EVENT_SOURCE_PROPS`, which a future `kinesisEventSource` reuses):

| Property                  | Default                     | Rationale                                                                                                            |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `startingPosition`        | `LATEST`                    | A newly-attached consumer reads from the stream tip, not the source's existing change history.                       |
| `reportBatchItemFailures` | `true`                      | A single poison record fails only its own record, not the whole batch. CDK defaults this `false`.                    |
| `bisectBatchOnError`      | `true`                      | Split and retry a failing batch, isolating a poison record instead of blocking the shard. CDK defaults this `false`. |
| `metricsConfig`           | `{ metrics: [EventCount] }` | Enables the per-mapping ESM metrics that back the event-source contextual alarms.                                    |

`startingPosition` is optional on `dynamoEventSource` (the default supplies it) —
unlike CDK's `DynamoEventSourceProps`, which requires it.

### Failure handling (dead-letter queue)

Bisecting isolates a poison record, but a record that never succeeds is still
retried until the stream's 24 h retention window expires unless you bound
`retryAttempts` / `maxRecordAge`. Bounding retries **without** a dead-letter
destination drops those records silently — so for durable failure handling, set
`onFailure` too. `dynamoEventSource` widens `onFailure` to accept a queue (or a
`ref()` to a sibling [`createQueueBuilder("dlq")`](../sqs) result) and wraps it
in an `SqsDlq` for you, resolving it alongside the table `ref` via `combine`:

```ts
.addEventSource(
  "orders",
  dynamoEventSource(ref("orders", (r) => r.table), {
    retryAttempts: 3,
    onFailure: ref("dlq", (r) => r.queue),
  }),
)
```

A queue is the common case, not the only one: `onFailure` accepts any
`IEventSourceDlq` — concrete or behind a `ref()` — and passes it through
unwrapped. An S3 failure destination, which captures the whole failed batch
rather than just the record metadata a DLQ message carries, wires up the same
way:

```ts
.addEventSource(
  "orders",
  dynamoEventSource(ref("orders", (r) => r.table), {
    retryAttempts: 3,
    onFailure: ref("failures", (r) => new S3OnFailureDestination(r.bucket)),
  }),
)
```

An S3 destination on a **DynamoDB stream** mapping needs **aws-cdk-lib ≥ 2.184.0**,
above this package's [floor](../../docs/adr/0008-aws-cdk-lib-version-floors.md) of
2.168.0. `DynamoEventSource` only opts into S3 destinations from that release;
below it CDK rejects the pairing at synth with `S3 onFailure Destination is not
supported for this event source`. The limit is CDK's, not this package's — a
queue destination works at the floor.

If retries or record-age are bounded but no `onFailure` destination is set, a
suppressible synth-time warning (`STREAM_DLQ_WARNING_ID`) fires. Silence it —
when dropping is intended — with
`Annotations.of(scope).acknowledgeWarning(STREAM_DLQ_WARNING_ID)`.

### Cross-component invariants

AWS Well-Architected guidance spans the queue and the function — the source
queue's visibility timeout should be ≥ 6× the function timeout, and its redrive
`maxReceiveCount` should be ≥ 5 before the DLQ. These are **not** enforced
today (the queue often arrives as an unresolved `ref()`); they are tracked in
[#123](https://github.com/laazyj/composureCDK/issues/123) and
[#124](https://github.com/laazyj/composureCDK/issues/124).

`kinesisEventSource` is still deferred — see
[#120](https://github.com/laazyj/composureCDK/issues/120).

## Deploy-time invocation: `.invokeOnDeploy()`

Some work has to happen _as part of shipping the stack_, and its outcome has to
gate the deployment: registering the release with an external service, calling
the system you just deployed to prove it answers, seeding reference data through
a service API. `.invokeOnDeploy()` invokes the function once during deployment
and **fails the deployment if the function fails** — the stack rolls back and
the handler's error message lands in the CloudFormation events.

```ts
import { compose, ref } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";

compose(
  {
    register: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(Code.fromAsset("register"))
      .timeout(Duration.seconds(30))
      .environment({ API_URL: "https://releases.example.com/v1/register" })
      .invokeOnDeploy({ after: [ref("api", (r: RestApiBuilderResult) => r.api)] }),

    api: createRestApiBuilder().restApiName("Orders"),
  },
  { api: [], register: ["api"] },
).build(stack, "Release");
```

It is a domain action on the function builder ([ADR-0016](../../docs/adr/0016-domain-action-custom-resource.md)),
backed by the CDK [`Trigger`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.triggers-readme.html)
construct. The custom resource is exposed on the build result as
`deploymentTrigger`, so a sibling can be ordered against the call itself
(`deploymentTrigger.executeBefore(...)`).

### The handler must throw

**A handler that returns an error rather than throwing does not fail the
deployment.** Lambda considers an invocation that returns successful no matter
what the payload says, so an HTTP-shaped `{ statusCode: 500 }` — or a caught
error folded into the response — deploys green:

```ts
export const handler = async () => {
  const response = await fetch(process.env.API_URL, { method: "POST" });
  if (!response.ok) {
    // Throw. Returning `{ statusCode: response.status }` here would deploy green.
    throw new Error(`Registration failed: ${response.status} ${await response.text()}`);
  }
};
```

### Ordering

The function's own execution role is always waited for, so policies attached by
`.grant()` and `.configureRole()` exist before the handler runs — CloudFormation
does not otherwise sequence those ahead of a custom resource, and the handler
would race them. Everything else the call depends on goes in `after`, as
concrete constructs or `ref(...)` references to sibling components.

### Defaults

| Option                   | Default                          | Rationale                                                                                                                                                                                |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| invocation type          | `RequestResponse` (not settable) | The deployment waits for the result. An asynchronous invocation returns before the work happens, reporting success whatever the handler did — the opposite of the point.                 |
| `timeout`                | function `timeout` + 30s         | The deployment outlives the handler, so a handler that runs to its limit reports _its_ error ("Task timed out after …") instead of the deployment abandoning the call. Capped at 15 min. |
| `executeOnHandlerChange` | `true`                           | Re-invokes when the handler's code or configuration changes; a no-op on unrelated stack updates.                                                                                         |

The derivation values are exported as `DEPLOYMENT_INVOKE_DEFAULTS`. With no
function `timeout` set (or a token one), the wait falls back to 2 minutes,
matching CDK's own `Trigger` default.

Whenever the wait ends up at or below the function's own timeout, a suppressible
warning fires under `DEPLOY_INVOKE_TIMEOUT_WARNING_ID` — the deployment would
stop waiting while the handler is still running, so a slow call fails the stack
as an abandoned invocation rather than reporting the handler's error. That
covers an explicit `timeout` set too low, and also a function at Lambda's
15-minute maximum, where the 15-minute cap leaves no margin to add.

### What it does not do

- **It does not invoke on every deployment.** With `executeOnHandlerChange: true`
  the invocation re-runs when the handler changes; with `false` it runs only on
  the stack's first deployment. CDK's `Trigger` offers no "always" mode.
- **It does not invoke on stack deletion.** For teardown-time work, use
  [`@composurecdk/custom-resources`](../custom-resources/README.md), which has
  create/update/**delete** semantics.
- **It creates no alarms.** The custom resource runs once per deployment, not
  continuously; there is no steady-state signal to alarm on. Failures surface as
  a failed deployment.
- **It is not a general SDK-call escape hatch.** A call that has no
  CloudFormation resource but needs no handler of yours belongs in
  `createAwsCustomResourceBuilder()` — that builder invokes an AWS API directly,
  no Lambda of yours involved.

## Examples

- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with recommended alarms, custom alarms, and SNS alarm actions
- [MultiStackApp](../examples/src/multi-stack-app.ts) — Lambda split across stacks via `.withStacks()`, wired with `ref`
- [OrderProcessorStack](../examples/src/order-processor-app.ts) — SQS queue wired to a Lambda consumer via `sqsEventSource`
- [DynamoStreamProcessorStack](../examples/src/dynamo-stream-processor-app.ts) — DynamoDB stream wired to a Lambda consumer via `dynamoEventSource`, with bisect-on-error, bounded retries, and an `onFailure` SQS DLQ
