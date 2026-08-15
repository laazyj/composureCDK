# @composurecdk/kms

AWS Key Management Service builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for KMS customer-managed keys (CMKs) with secure, AWS-recommended defaults, consumer-side grant helpers, and the AWS-recommended imported-key-material expiry alarm. It wraps the CDK [Key](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.Key.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Key Builder

```ts
import { createKeyBuilder } from "@composurecdk/kms";

const { key, alias } = createKeyBuilder()
  .description("Encrypts the Orders table at rest.")
  .alias("orders/table")
  .build(stack, "OrdersTableKey");
```

Every [KeyProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.KeyProps.html) property is available as a fluent setter on the builder.

## Keys as components

The point of the builder is that a CMK stops being a construct you create imperatively before `compose` and becomes an ordinary component: placed by the stack strategy, ordered by the dependency graph, and visible in the dependency map as the edge it is.

The key-consuming props on the library's stateful resources accept a `Resolvable`, so the key is wired in with `ref()`:

| Package                  | Prop                    | Accepts                              |
| ------------------------ | ----------------------- | ------------------------------------ |
| `@composurecdk/s3`       | `encryptionKey`         | `Resolvable<IKey>`                   |
| `@composurecdk/dynamodb` | `encryption` (V2)       | `Resolvable<TableEncryptionV2>`      |
| `@composurecdk/dynamodb` | `encryptionKey`         | `Resolvable<IKey>` (classic `Table`) |
| `@composurecdk/sqs`      | `encryptionMasterKey`   | `Resolvable<IKey>`                   |
| `@composurecdk/sns`      | `masterKey`             | `Resolvable<IKey>`                   |
| `@composurecdk/logs`     | `encryptionKey`         | `Resolvable<IKey>`                   |
| `@composurecdk/lambda`   | `environmentEncryption` | `Resolvable<IKey>`                   |
| `@composurecdk/neptune`  | `kmsKey`                | `Resolvable<IKey>`                   |

An `IKey` is what these props are written against, but it is not the limit of what they take: where CDK has widened a prop to the broader [`kms.IKeyRef`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.IKeyRef.html), the builder's prop is read from CDK's own type rather than pinned to an interface, so it accepts whatever the `aws-cdk-lib` you have installed accepts. The `keyGrants` helpers below are pinned to `IKey`, so a key that is only an `IKeyRef` reaches a resource prop but not a grant.

For a key-consuming prop not listed above, build the key as a component and pass `result.key` to it.

```ts
import { AttributeType, TableEncryptionV2 } from "aws-cdk-lib/aws-dynamodb";
import { compose, ref } from "@composurecdk/core";
import { createKeyBuilder, type KeyBuilderResult } from "@composurecdk/kms";
import { createTableV2Builder } from "@composurecdk/dynamodb";
import { createBucketBuilder } from "@composurecdk/s3";

compose(
  {
    tableKey: createKeyBuilder().description("Encrypts the Task State table at rest."),
    dlqBucketKey: createKeyBuilder().description("Encrypts the task publisher DLQ bucket."),

    taskStateTable: createTableV2Builder()
      .partitionKey({ name: "taskId", type: AttributeType.STRING })
      .encryption(
        ref("tableKey", (r: KeyBuilderResult) => TableEncryptionV2.customerManagedKey(r.key)),
      ),

    dlqBucket: createBucketBuilder().encryptionKey(
      ref<KeyBuilderResult>("dlqBucketKey").get("key"),
    ),
  },
  {
    tableKey: [],
    dlqBucketKey: [],
    taskStateTable: ["tableKey"],
    dlqBucket: ["dlqBucketKey"],
  },
).build(stack, "Persistence");
```

Both `encryptionKey`-style props infer the customer-managed encryption mode when a key is supplied, so there is no second prop to remember: `@composurecdk/s3` switches from `BucketEncryption.S3_MANAGED` to `KMS`, `@composurecdk/sqs` from `QueueEncryption.SQS_MANAGED` to `KMS`, and the classic DynamoDB `Table` from `AWS_MANAGED` to `CUSTOMER_MANAGED` (ADR-0009).

## Secure Defaults

`createKeyBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property            | Default                | Rationale                                                                      |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `enableKeyRotation` | `true`                 | Automatic yearly rotation of key material; transparent to existing ciphertext. |
| `removalPolicy`     | `RemovalPolicy.RETAIN` | Deleting a key permanently destroys every ciphertext it protects.              |
| `pendingWindow`     | `Duration.days(30)`    | The maximum window in which a scheduled deletion can still be cancelled.       |

These defaults follow the [Security Pillar's key-management guidance](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_protect_data_rest_key_mgmt.html) and the [AWS KMS key rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html) and [key deletion](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html) documentation.

AWS KMS only rotates symmetric encryption keys, so the `enableKeyRotation` default yields to a `keySpec` that cannot rotate — setting `.keySpec(KeySpec.RSA_4096)` produces a working asymmetric key rather than a CDK validation error ([ADR-0009](../../docs/adr/0009-defaults-yield-to-mutually-exclusive-siblings.md)). Asking for both explicitly is still an error, raised by CDK.

The defaults are exported as `KEY_DEFAULTS` for visibility and testing:

```ts
import { KEY_DEFAULTS } from "@composurecdk/kms";
```

## Aliases

`.alias("orders/table")` creates an `AWS::KMS::Alias` for the key and returns it in the build result. The `alias/` prefix is added if you omit it, and CDK rejects a name outside the AWS-allowed character set at synth.

```ts
const { alias } = createKeyBuilder().alias("orders/table").build(stack, "OrdersTableKey");
// alias.aliasName === "alias/orders/table"
```

## Grants

Consumer-side grant helpers ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)) — declared on the grantee, applied at its build:

```ts
import { keyGrants } from "@composurecdk/kms";

const handler = createFunctionBuilder().grant(
  keyGrants.decrypt(ref<KeyBuilderResult>("tableKey").get("key")),
);
```

| Helper                     | Actions                                                 |
| -------------------------- | ------------------------------------------------------- |
| `keyGrants.encrypt`        | `kms:Encrypt`, `kms:ReEncrypt*`, `kms:GenerateDataKey*` |
| `keyGrants.decrypt`        | `kms:Decrypt`                                           |
| `keyGrants.encryptDecrypt` | both of the above                                       |
| `keyGrants.sign`           | `kms:Sign`                                              |
| `keyGrants.verify`         | `kms:Verify`                                            |
| `keyGrants.signVerify`     | both of the above                                       |
| `keyGrants.generateMac`    | `kms:GenerateMac`                                       |
| `keyGrants.verifyMac`      | `kms:VerifyMac`                                         |
| `keyGrants.admin`          | key administration only — no cryptographic use          |

A grant on the encrypted **resource** usually covers its key already: `bucketGrants.write` and `tableGrants.read` extend to the resource's `encryptionKey` when CDK knows about it. Reach for `keyGrants` for what it cannot infer — a principal decrypting ciphertext it fetched elsewhere, an envelope-encryption client calling `GenerateDataKey` directly, or a key shared with a resource the grantee holds no grant on.

## Recommended Alarms

AWS's [recommended alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html) for KMS cover one metric: `SecondsUntilKeyMaterialExpiration`. It is **opt-in** — KMS publishes the metric only for keys whose material was [imported](https://docs.aws.amazon.com/kms/latest/developerguide/importing-keys.html) with an expiration date, so on a key created by CloudFormation the alarm could never leave `INSUFFICIENT_DATA`.

Switch it on for a key you import material into:

```ts
const key = createKeyBuilder().recommendedAlarms({ keyMaterialExpiration: true });
```

| Alarm                   | Metric                                              | Default threshold       |
| ----------------------- | --------------------------------------------------- | ----------------------- |
| `keyMaterialExpiration` | SecondsUntilKeyMaterialExpiration (Minimum, 1 hour) | ≤ 2,592,000 s (30 days) |

`treatMissingData` defaults to `ignore` so the alarm latches: KMS stops publishing the metric once the material has actually expired, and `notBreaching` would clear the alarm at exactly the moment the key stopped working.

The defaults are exported as `KEY_ALARM_DEFAULTS` for visibility and testing:

```ts
import { KEY_ALARM_DEFAULTS } from "@composurecdk/kms";
```

### Customizing thresholds

```ts
const key = createKeyBuilder().recommendedAlarms({
  keyMaterialExpiration: { threshold: 604800 }, // 7 days, in seconds
});
```

### Disabling alarms

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

### Custom alarms

Add custom alarms via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `IKey`, so the metric factory has access to the key at build time.

```ts
import { Duration } from "aws-cdk-lib";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

const key = createKeyBuilder().addAlarm("urgentExpiry", (alarm) =>
  alarm
    .metric(
      (k) =>
        new Metric({
          namespace: "AWS/KMS",
          metricName: "SecondsUntilKeyMaterialExpiration",
          dimensionsMap: { KeyId: k.keyId },
          statistic: "Minimum",
          period: Duration.hours(1),
        }),
    )
    .threshold(Duration.days(3).toSeconds())
    .lessThanOrEqual()
    .description("Imported key material expires within 3 days — page oncall"),
);
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = key.build(stack, "OrdersTableKey");

for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

Or apply them across a whole scope with [`alarmActionsPolicy`](../cloudwatch/README.md).

## Cost

A customer-managed key costs $1/month plus per-request charges, and a key kept for its full 30-day pending-deletion window keeps billing until deletion completes. An AWS-managed key (`aws/dynamodb`, `aws/s3`) is free and is what the library's own encryption defaults use — reach for a CMK when you need control over the key policy, CloudTrail visibility of individual decrypt calls, or an independent rotation schedule. See [KMS pricing](https://aws.amazon.com/kms/pricing/).
