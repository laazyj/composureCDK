# @composurecdk/stepfunctions

AWS Step Functions builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for state machines with secure, AWS-recommended defaults. It wraps the CDK [StateMachine](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions.StateMachine.html) construct — refer to the CDK documentation for the full set of configurable properties. The states themselves (`Pass`, `Choice`, `Map`, and the service integrations in `aws-cdk-lib/aws-stepfunctions-tasks`) are CDK's own; the builder does not wrap them.

## State Machine Builder

```ts
import { Duration } from "aws-cdk-lib";
import { Pass, Succeed } from "aws-cdk-lib/aws-stepfunctions";
import { createStateMachineBuilder } from "@composurecdk/stepfunctions";

const workflow = createStateMachineBuilder()
  .timeout(Duration.minutes(5))
  .definition((scope) => new Pass(scope, "Prepare").next(new Succeed(scope, "Done")))
  .build(stack, "Workflow");
```

Every [StateMachineProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_stepfunctions.StateMachineProps.html) property except the deprecated `definition` is available as a fluent setter on the builder.

### Writing the workflow

States are CDK constructs, so they need a scope — and the resources a task calls are built by sibling components that do not exist until build time. `.definition(...)` therefore takes a callback the builder invokes during `build`, with a scope reserved for this state machine's states. State ids need only be unique within the workflow; they become the state names in the Amazon States Language.

To reach a sibling, wrap the callback in a `ref`:

```ts
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import type { Construct } from "constructs";
import { compose, ref } from "@composurecdk/core";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";

compose(
  {
    validate: createFunctionBuilder()./* ... */,
    workflow: createStateMachineBuilder()
      .timeout(Duration.minutes(5))
      .definition(
        ref(
          "validate",
          (r: FunctionBuilderResult) => (scope: Construct) =>
            new LambdaInvoke(scope, "Validate", { lambdaFunction: r.function }),
        ),
      ),
  },
  { validate: [], workflow: ["validate"] },
);
```

Where tasks call more than one sibling, use [`combine`](../core/README.md):

```ts
.definition(
  combine(
    {
      validate: ref<FunctionBuilderResult>("validate").get("function"),
      orders: ref<TableV2BuilderResult>("orders").get("table"),
    },
    ({ validate, orders }) =>
      (scope: Construct) =>
        new LambdaInvoke(scope, "Validate", { lambdaFunction: validate }).next(
          new DynamoPutItem(scope, "Record", { table: orders, item: { /* ... */ } }),
        ),
  ),
)
```

Task states written in CDK add the IAM their service call needs to the execution role, scoped to the resource — `LambdaInvoke` grants `lambda:InvokeFunction` on that function, `DynamoPutItem` grants `dynamodb:PutItem` on that table.

### Amazon States Language documents

For a workflow kept as ASL, set `definitionBody` instead. `definitionSubstitutions` fills its `${...}` placeholders, and each value is independently `Resolvable`:

```ts
createStateMachineBuilder()
  .definitionBody(DefinitionBody.fromFile("workflows/orders.asl.json"))
  .definitionSubstitutions({
    ValidateArn: ref("validate", (r: FunctionBuilderResult) => r.function.functionArn),
    Stage: "prod",
  })
  .grant(functionGrants.invoke(ref("validate", (r: FunctionBuilderResult) => r.function)));
```

An ASL document carries no IAM — CDK cannot see which resources its tasks call — so grant each one with `.grant(...)`. `.definition()` and `definitionBody` are mutually exclusive.

## Secure Defaults

`createStateMachineBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                    | Default                                     | Rationale                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tracingEnabled`            | `true`                                      | X-Ray follows a request through every state and into the services its tasks call ([Serverless Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html)).                                                                                                                                               |
| `stateMachineName`          | A generated unique name                     | Keeps a customer-managed key usable, and the resource stable if one is added later — see [Encryption at rest](#encryption-at-rest).                                                                                                                                                                                                                                |
| `logs.destination`          | A log group under `/aws/vendedlogs/states/` | CDK's default is no logging. Security Hub [StepFunctions.1](https://docs.aws.amazon.com/securityhub/latest/userguide/stepfunctions-controls.html#stepfunctions-1) requires it, and the [vended-logs prefix](https://docs.aws.amazon.com/step-functions/latest/dg/bp-cwl.html) keeps the account's CloudWatch Logs resource policy under its 5,120-character limit. |
| `logs.level`                | `ERROR` (Standard), `ALL` (Express)         | A Standard workflow keeps its full history in Step Functions, so its logs need only the failures. An [Express workflow has no history](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html) beyond what it logs.                                                                                                                                     |
| `logs.includeExecutionData` | `false`                                     | Each state's input and output is the workload's own data and may be sensitive ([Serverless Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/data-protection.html)). Opt in where the logs are protected accordingly.                                                                                                          |

The log group is built with [`@composurecdk/logs`](../logs/README.md), so it inherits that package's defaults — two-year retention, retained when the stack is deleted — and is returned as `result.logGroup`. Supply your own with `.logs({ destination })`, or set `.logs({ level: LogLevel.OFF })`; neither creates one. A partial `.logs({...})` merges over the defaults for the state machine's type.

The defaults are exported as `STATE_MACHINE_DEFAULTS` and `STATE_MACHINE_LOG_DEFAULTS`.

### Timeouts

CDK sets no timeout, so a Standard execution waiting on a task that never answers stays open for up to a year. Well-Architected [REL05-BP05](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_client_timeouts.html) advises against relying on defaults here, so the builder **requires** one: building a Standard workflow written with `.definition()` (or any chain) and no `.timeout(...)` throws. The right bound is the workload's, so the builder does not pick one; to allow the maximum deliberately, set `Duration.days(365)`. An Express execution is capped at five minutes, so it needs none. An ASL document must carry its own top-level `TimeoutSeconds`: CDK applies `.timeout()` only to a chain ([aws-cdk#37150](https://github.com/aws/aws-cdk/issues/37150)), and the builder cannot inspect a document uploaded as an asset.

Set `TimeoutSeconds` (and `HeartbeatSeconds`, for callbacks) on individual task states too — the [Step Functions best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html) explain why.

### Encryption at rest

Step Functions encrypts the definition and execution history with an AWS-owned key. To use your own, pass a `CustomerManagedEncryptionConfiguration`, typically mapped from a [`@composurecdk/kms`](../kms/README.md) key:

```ts
compose(
  {
    workflowKey: createKeyBuilder().description("Encrypts the orders workflow at rest."),
    workflow: createStateMachineBuilder()
      .timeout(Duration.minutes(5))
      .definition(/* ... */)
      .encryptionConfiguration(
        ref<KeyBuilderResult>("workflowKey")
          .get("key")
          .map((key) => new CustomerManagedEncryptionConfiguration(key)),
      ),
  },
  { workflowKey: [], workflow: ["workflowKey"] },
);
```

CDK grants the execution role the key, conditioned on the state machine's ARN — which it builds from the state machine's _name_. An unnamed state machine leaves that condition matching nothing, and every execution is denied the key ([aws-cdk#38958](https://github.com/aws/aws-cdk/issues/38958)). The builder therefore always names the state machine when you don't (`<stack>-<path>-<hash>`, at most 80 characters) — always, not only once a key is set, because changing a state machine's name replaces it, losing its execution history and any running executions. Set your own with `.stateMachineName(...)`.

CDK does not grant **callers** the key. `DescribeExecution`, `GetExecutionHistory` and `StartSyncExecution` need `kms:Decrypt` on it, so a grantee using `stateMachineGrants.read` or `startSyncExecution` on an encrypted state machine also needs `keyGrants.decrypt` ([what each API needs](https://docs.aws.amazon.com/step-functions/latest/dg/encryption-at-rest.html)).

## Execution role

CDK creates the execution role unless one is supplied with `.role(...)`, which accepts a `Resolvable`. Either way it is returned as `result.role`. The log-delivery and X-Ray actions CDK adds are on `*`, because those APIs [do not support resource-level permissions](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html), so a hand-built role would gain nothing over CDK's.

The state machine is a **grantee**: `.grant(...)` adds a sibling's capability to its role, for a resource its tasks call that CDK cannot see — one named in an ASL document, or reached through a generic `CallAwsService` task. See [ADR-0013](../../docs/adr/0013-consumer-side-grants.md).

## Grants

The state machine is also a **resource**. `stateMachineGrants` lets another component drive it:

```ts
import { stateMachineGrants, type StateMachineBuilderResult } from "@composurecdk/stepfunctions";

createFunctionBuilder().grant(
  stateMachineGrants.startExecution(ref<StateMachineBuilderResult>("workflow").get("stateMachine")),
);
```

| Capability           | Actions                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `startExecution`     | `states:StartExecution`                                                          |
| `startSyncExecution` | `states:StartSyncExecution` (Express only)                                       |
| `read`               | `states:DescribeExecution`, `GetExecutionHistory`, `ListExecutions`, and related |
| `taskResponse`       | `states:SendTaskSuccess`, `SendTaskFailure`, `SendTaskHeartbeat`                 |
| `redriveExecution`   | `states:RedriveExecution` (Standard only)                                        |

## Starting executions from other services

The CDK integrations accept the built state machine through a `ref`, with no change to this package:

- **EventBridge** — `sfnStateMachineTarget(ref(...))` from [`@composurecdk/events`](../events/README.md).
- **API Gateway** — `StepFunctionsIntegration.startExecution(...)` inside `addMethod(...)` on [`@composurecdk/apigateway`](../apigateway/README.md). CDK requires an **Express** state machine here, because the integration calls `StartSyncExecution`.
