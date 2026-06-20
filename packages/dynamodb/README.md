# @composurecdk/dynamodb

DynamoDB table builders for [ComposureCDK](../../README.md).

This package provides fluent builders for DynamoDB tables with secure, AWS-recommended defaults and built-in CloudWatch alarms. It ships **two builders**, one per CDK construct:

| Factory                  | CDK construct                                                                                  | CloudFormation resource      | Use for                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `createTableV2Builder()` | [`TableV2`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.TableV2.html) | `AWS::DynamoDB::GlobalTable` | **New tables (recommended).**                                   |
| `createTableBuilder()`   | [`Table`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.Table.html)     | `AWS::DynamoDB::Table`       | `importSource` (S3 bulk import) and parity with classic tables. |

Both share the same well-architected defaults intent, the same recommended alarms, and the same `ref()`-able result shape — they differ only in the underlying CDK prop surface.

### Which builder should I use?

For **new tables, prefer `createTableV2Builder()`**. A single-region `TableV2` bills the same as a classic table, but it future-proofs the one irreversible part of the decision: you can add cross-region replicas later without replacing the table. `ITableV2 extends ITable`, so a built `TableV2` works everywhere an `ITable` is expected (IAM grants, `DynamoEventSource`) — composition wiring is identical for both builders.

Reach for the classic `createTableBuilder()` when you need an `importSource` (S3 bulk import is V1-only, with no `TableV2` equivalent) or parity with existing classic tables.

> ⚠️ **`Table` and `TableV2` are different CloudFormation resources** (`AWS::DynamoDB::Table` vs. `AWS::DynamoDB::GlobalTable`). CloudFormation **cannot migrate between them in place** — swapping the construct on an existing table is a resource replacement, which deletes and recreates the table. Choose deliberately up front.

## TableV2 builder (recommended)

```ts
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { createTableV2Builder } from "@composurecdk/dynamodb";

const orders = createTableV2Builder()
  .partitionKey({ name: "orderId", type: AttributeType.STRING })
  .sortKey({ name: "createdAt", type: AttributeType.NUMBER })
  .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES)
  .build(stack, "Orders");
```

Every [`TablePropsV2`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.TablePropsV2.html) property is available as a fluent setter. Note the V2 prop shape differs from the classic one — billing is a single `.billing(Billing.onDemand())` helper, encryption is `.encryption(TableEncryptionV2.awsManagedKey())`, and the stream is `.dynamoStream(StreamViewType…)`. `partitionKey` is the one property the builder does not default — the key schema is workload-specific, so it must be set before `build()`.

## Classic Table builder

```ts
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { createTableBuilder } from "@composurecdk/dynamodb";

const orders = createTableBuilder()
  .partitionKey({ name: "orderId", type: AttributeType.STRING })
  .sortKey({ name: "createdAt", type: AttributeType.NUMBER })
  .stream(StreamViewType.NEW_AND_OLD_IMAGES)
  .build(stack, "Orders");
```

Every [`TableProps`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.TableProps.html) property is available as a fluent setter, including `importSource` for [S3 bulk import](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataImport.HowItWorks.html) — the main reason to choose the classic builder.

## Secure Defaults

Both builders apply the same well-architected intent, encoded against each construct's prop shape. Each default can be overridden via the builder's fluent API.

| Intent                 | TableV2 (`TABLE_V2_DEFAULTS`)                   | Classic (`TABLE_DEFAULTS`)                 | Rationale                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-demand billing      | `billing: Billing.onDemand()`                   | `billingMode: BillingMode.PAY_PER_REQUEST` | No forecasting, scales with traffic, avoids throttling from under-provisioning. Switch to provisioned for steady, predictable workloads.                                                                                                                                                          |
| Encryption at rest     | `encryption: TableEncryptionV2.awsManagedKey()` | `encryption: TableEncryption.AWS_MANAGED`  | Encrypts with the AWS-managed `aws/dynamodb` KMS key — visible in the account and logged in CloudTrail, unlike the free AWS-owned default key. Bring-your-own KMS is opt-in. ([Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html)) |
| Point-in-time recovery | `pointInTimeRecoverySpecification: { … }`       | `pointInTimeRecoverySpecification: { … }`  | Continuous backups — restore to any second in the preceding 35 days. ([PITR](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html))                                                                                                                          |
| Deletion protection    | `deletionProtection: true`                      | `deletionProtection: true`                 | Blocks table deletion (API, console, or `cdk destroy`) until explicitly disabled. Override with `.deletionProtection(false)` for ephemeral tables.                                                                                                                                                |

The defaults are exported for visibility and testing:

```ts
import { TABLE_DEFAULTS, TABLE_V2_DEFAULTS } from "@composurecdk/dynamodb";
```

## DynamoDB Streams

Enable a stream with `.dynamoStream(StreamViewType…)` (TableV2) or `.stream(StreamViewType…)` (classic). The build result surfaces the stream ARN so a downstream component can wire a consumer:

```ts
const result = createTableV2Builder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES)
  .build(stack, "Events");

result.tableStreamArn; // string — feed into a Lambda DynamoEventSource, etc.
result.table; // the table itself, which a DynamoEventSource consumes
```

Neither construct exposes a distinct stream construct — the stream is an attribute of the table — so the result exposes `tableStreamArn` directly. It is `undefined` when no stream is configured, on both builders, so a `ref()` consumer can branch on its presence.

## Recommended Alarms

Both builders create the same [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm                 | Metric                                      | Default threshold | Rationale                                                        |
| --------------------- | ------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `systemErrors`        | `SystemErrors` (Sum across core ops, 1 min) | > 0               | Server-side (HTTP 500) faults — a table availability signal.     |
| `readThrottleEvents`  | `ReadThrottleEvents` (Sum, 1 min)           | > 0               | Read throttling — hot partition or insufficient read capacity.   |
| `writeThrottleEvents` | `WriteThrottleEvents` (Sum, 1 min)          | > 0               | Write throttling — hot partition or insufficient write capacity. |

The thresholds are deliberately strict — a healthy table should sit at zero. Tune them up for workloads where brief, self-correcting throttling under burst is acceptable.

`SystemErrors` is emitted per-operation, and a CloudWatch alarm on a metric-math expression can reference at most 10 metrics, so the `systemErrors` alarm sums the ten core data-plane operations (`GetItem`, `BatchGetItem`, `Query`, `Scan`, `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactGetItems`, `TransactWriteItems`). The PartiQL statement operations and the stream `GetRecords` operation are excluded; add a custom alarm if your errors live there.

The defaults are exported as `TABLE_ALARM_DEFAULTS` for visibility and testing:

```ts
import { TABLE_ALARM_DEFAULTS } from "@composurecdk/dynamodb";
```

### What is not alarmed by default

- **Account-level utilization alarms** (`AccountProvisionedReadCapacityUtilization`, `AccountProvisionedWriteCapacityUtilization`) from the AWS recommended-alarms list are account-scoped, not table-scoped, so they do not belong to a per-table builder.
- **Provisioned-capacity utilization** (consumed vs. provisioned) only applies to provisioned tables; the default billing mode here is on-demand. Add it via `addAlarm` on a provisioned table.
- **`UserErrors` / `ConditionalCheckFailedRequests`** are caller- or application-level signals (HTTP 400) and too workload-dependent for a useful generic threshold.

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const table = createTableV2Builder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .recommendedAlarms({
    readThrottleEvents: { threshold: 10, evaluationPeriods: 3 },
  });
```

### Disabling alarms

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
// or individually
builder.recommendedAlarms({ writeThrottleEvents: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `ITable`, so the metric factory has access to the table's metric helpers.

```ts
import { Duration } from "aws-cdk-lib";

const table = createTableV2Builder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .addAlarm("userErrors", (alarm) =>
    alarm
      .metric((table) => table.metricUserErrors({ period: Duration.minutes(5) }))
      .threshold(5)
      .greaterThan()
      .description("Table is returning client-side (HTTP 400) errors."),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = createTableV2Builder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .build(stack, "Orders");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

For composing the alarm-actions wiring across multiple builders in a single `compose` system, see [`alarmActionsPolicy`](../cloudwatch/README.md) in `@composurecdk/cloudwatch`.

## Composition

Both builders implement `Lifecycle`, so they slot into a `compose` system and expose a `ref()`-able stream for wiring a consumer (e.g. a Lambda `DynamoEventSource`):

```ts
import { compose } from "@composurecdk/core";
import { createTableV2Builder } from "@composurecdk/dynamodb";
import { createFunctionBuilder } from "@composurecdk/lambda";

const system = compose(
  {
    orders: createTableV2Builder()
      .partitionKey({ name: "pk", type: AttributeType.STRING })
      .dynamoStream(StreamViewType.NEW_AND_OLD_IMAGES),
    processor: createFunctionBuilder(),
  },
  { orders: [], processor: ["orders"] },
);
```
