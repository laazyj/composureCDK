# @composurecdk/dynamodb

DynamoDB table builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for DynamoDB tables with secure, AWS-recommended defaults and built-in CloudWatch alarms. It wraps the CDK [Table](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.Table.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Table Builder

```ts
import { AttributeType, StreamViewType } from "aws-cdk-lib/aws-dynamodb";
import { createTableBuilder } from "@composurecdk/dynamodb";

const orders = createTableBuilder()
  .partitionKey({ name: "orderId", type: AttributeType.STRING })
  .sortKey({ name: "createdAt", type: AttributeType.NUMBER })
  .stream(StreamViewType.NEW_AND_OLD_IMAGES)
  .build(stack, "Orders");
```

Every [TableProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb.TableProps.html) property is available as a fluent setter on the builder. `partitionKey` is the one property the builder does not default — the key schema is workload-specific, so it must be set before `build()`.

## Secure Defaults

`createTableBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                           | Default                                | Rationale                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billingMode`                      | `BillingMode.PAY_PER_REQUEST`          | On-demand capacity — no forecasting, scales with traffic, avoids throttling from under-provisioning. Switch to `PROVISIONED` (implicitly, by setting `.readCapacity()` / `.writeCapacity()`) for steady, predictable workloads.                                                                                                     |
| `encryption`                       | `TableEncryption.AWS_MANAGED`          | Encrypts at rest with the AWS-managed `aws/dynamodb` KMS key — visible in the account and logged in CloudTrail, unlike the free AWS-owned default key. Bring-your-own KMS is opt-in via `.encryptionKey(key)`. ([Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html)) |
| `pointInTimeRecoverySpecification` | `{ pointInTimeRecoveryEnabled: true }` | Continuous backups — restore to any second in the preceding 35 days. ([PITR](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html))                                                                                                                                                            |
| `deletionProtection`               | `true`                                 | Blocks table deletion (API, console, or `cdk destroy`) until explicitly disabled. Override with `.deletionProtection(false)` for ephemeral tables.                                                                                                                                                                                  |

The defaults are exported as `TABLE_DEFAULTS` for visibility and testing:

```ts
import { TABLE_DEFAULTS } from "@composurecdk/dynamodb";
```

### Defaults that yield to a sibling you set

Two defaults are mutually exclusive with a sibling property and step aside when you set it ([ADR-0009](../../docs/adr/0009-defaults-yield-to-mutually-exclusive-siblings.md)):

- Setting `.readCapacity()` / `.writeCapacity()` drops the `PAY_PER_REQUEST` default so CDK uses `PROVISIONED` billing.
- Setting `.encryptionKey()` infers `TableEncryption.CUSTOMER_MANAGED` (CDK only accepts a key under customer-managed encryption).

## DynamoDB Streams

Enable a stream with `.stream(StreamViewType…)`. The build result surfaces the stream ARN so a downstream component can wire a consumer:

```ts
const result = createTableBuilder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .stream(StreamViewType.NEW_AND_OLD_IMAGES)
  .build(stack, "Events");

result.tableStreamArn; // string — feed into a Lambda DynamoEventSource, etc.
result.table; // the Table itself, which a DynamoEventSource consumes
```

The classic `Table` construct has no distinct stream construct — the stream is an attribute of the table — so the result exposes `tableStreamArn` directly rather than a separate construct.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#DynamoDB) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

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
- **Provisioned-capacity utilization** (consumed vs. provisioned) only applies to `PROVISIONED` tables; the default billing mode here is on-demand. Add it via `addAlarm` on a provisioned table.
- **`UserErrors` / `ConditionalCheckFailedRequests`** are caller- or application-level signals (HTTP 400) and too workload-dependent for a useful generic threshold.

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const table = createTableBuilder()
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

const table = createTableBuilder()
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
const result = createTableBuilder()
  .partitionKey({ name: "pk", type: AttributeType.STRING })
  .build(stack, "Orders");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

For composing the alarm-actions wiring across multiple builders in a single `compose` system, see [`alarmActionsPolicy`](../cloudwatch/README.md) in `@composurecdk/cloudwatch`.
