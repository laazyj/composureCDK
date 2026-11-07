# @composurecdk/kinesis

Kinesis Data Streams builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for Amazon Kinesis data streams with secure, AWS-recommended defaults. It wraps the CDK [Stream](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kinesis.Stream.html) construct — refer to the CDK documentation for the full set of configurable properties.

```ts
import { createStreamBuilder } from "@composurecdk/kinesis";

const telemetry = createStreamBuilder().streamName("telemetry").build(stack, "Telemetry");
```

The result is `{ stream, alarms, key? }`:

| Field    | Type                    | Description                                                                                                                                                         |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream` | `Stream`                | The data stream.                                                                                                                                                    |
| `alarms` | `Record<string, Alarm>` | Alarms created for the stream, keyed by name — see [Alarms](#alarms).                                                                                               |
| `key`    | `IKey \| undefined`     | The customer-managed encryption key: the one you supplied, or the one CDK creates for `encryption: StreamEncryption.KMS` without a key. Absent for the managed key. |

## Secure Defaults

`createStreamBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property          | Default                    | CDK default                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encryption`      | `StreamEncryption.MANAGED` | `alias/aws/kinesis`, behind a China-region condition | Encrypts records at rest with the AWS-managed key — Security Hub [Kinesis.1](https://docs.aws.amazon.com/securityhub/latest/userguide/kinesis-controls.html) at [no key cost](https://docs.aws.amazon.com/streams/latest/dev/costs-performance.html) and no extra grants. Stated, so the template has no region `CfnCondition`. Yields to `KMS` when `.encryptionKey(key)` is set — see below. |
| `retentionPeriod` | `Duration.hours(168)`      | 24 hours                                             | Security Hub [Kinesis.3](https://docs.aws.amazon.com/config/latest/developerguide/kinesis-stream-backup-retention-check.html) fails anything under 168 hours, and a week of replay lets a consumer recover from a long outage. **Costs money** — see below.                                                                                                                                    |
| `removalPolicy`   | `RemovalPolicy.RETAIN`     | `RETAIN`                                             | Keeps the stream, and the records still in it, when it leaves the stack. Same as CDK; stated so it is discoverable and stable.                                                                                                                                                                                                                                                                 |

The defaults are exported as `STREAM_DEFAULTS` for visibility and testing:

```ts
import { STREAM_DEFAULTS } from "@composurecdk/kinesis";
```

Not defaulted:

- **`shardLevelMetrics`** — enhanced monitoring is billed per shard per metric, and AWS does not recommend it by default. Opt in with `.shardLevelMetrics([...])`.
- **A resource policy** — same-account access needs none, and the stream's `grant*` methods add one for a cross-account grantee. Add statements with `result.stream.addToResourcePolicy(...)`.
- **TLS enforcement** — Kinesis only accepts HTTPS (TLS 1.2 or later, [infrastructure security](https://docs.aws.amazon.com/streams/latest/dev/infrastructure-security.html)), and AWS documents no `aws:SecureTransport` policy for it, unlike SQS and SNS. There is nothing to enforce.

### Capacity mode

Capacity mode is **not** defaulted: the builder keeps CDK's default of a provisioned stream with one shard, which is the cheapest idle stream and what a CDK user expects. Choose the mode for your workload ([capacity modes](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html), [pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)):

- **Provisioned** — set `.shardCount(n)`. Each shard takes 1 MB/s or 1,000 records/s of writes and 2 MB/s of reads; beyond that, requests are throttled (the `writeProvisionedThroughputExceeded` / `readProvisionedThroughputExceeded` alarms fire). Cheapest for a steady, well-understood workload.
- **On-demand** — set `.streamMode(StreamMode.ON_DEMAND)` and no shard count. Scales with traffic with no shard sizing, but carries a per-stream-hour charge, so an idle on-demand stream costs more than an idle single-shard one. Suits new or unpredictable workloads.

```ts
import { StreamMode } from "aws-cdk-lib/aws-kinesis";

const steady = createStreamBuilder().streamName("telemetry").shardCount(4);
const spiky = createStreamBuilder().streamName("clickstream").streamMode(StreamMode.ON_DEMAND);
```

### Retention cost

Retention above 24 hours is billed as extended retention — per shard-hour for a provisioned stream, per GB-month for an on-demand one ([pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)). If you do not need replay and are not held to Kinesis.3, set it back:

```ts
import { Duration } from "aws-cdk-lib";

createStreamBuilder().retentionPeriod(Duration.hours(24));
```

### Customer-managed encryption keys

`.encryptionKey(...)` accepts a concrete `IKey` or a `Resolvable`, so a key built by [`@composurecdk/kms`](../kms/README.md) can be a component of the same system:

```ts
import { compose, ref } from "@composurecdk/core";
import { createKeyBuilder, type KeyBuilderResult } from "@composurecdk/kms";
import { createStreamBuilder } from "@composurecdk/kinesis";

compose(
  {
    streamKey: createKeyBuilder().description("Encrypts the telemetry stream at rest."),
    telemetry: createStreamBuilder().encryptionKey(ref<KeyBuilderResult>("streamKey").get("key")),
  },
  { streamKey: [], telemetry: ["streamKey"] },
);
```

Supplying a key switches `encryption` from the `MANAGED` default to `StreamEncryption.KMS` ([ADR-0009](../../docs/adr/0009-defaults-yield-to-mutually-exclusive-siblings.md)). An explicit `encryption` still wins.

A customer-managed key is billed and must allow the stream's producers and consumers to use it — the [`streamGrants`](#grants) helpers grant the matching `kms:` actions alongside the `kinesis:` ones. See [permissions to use user-generated KMS keys](https://docs.aws.amazon.com/streams/latest/dev/permissions-user-key-KMS.html).

## Grants

`streamGrants` are consumer-side grant helpers ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)): pass one to a grantee builder's `grant(...)`. Each delegates to the stream's native `grant*` method, so a customer-managed key's `kms:` actions come with it.

| Helper      | Grants                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| `read`      | `kinesis:GetRecords`, `GetShardIterator`, `ListShards`, `DescribeStream*`, …; `kms:Decrypt` |
| `write`     | `kinesis:PutRecord`, `PutRecords`, `ListShards`; `kms:Encrypt`, `kms:GenerateDataKey*`, …   |
| `readWrite` | The union of `read` and `write`                                                             |

```ts
import { compose, ref } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";
import { createStreamBuilder, streamGrants, type StreamBuilderResult } from "@composurecdk/kinesis";

compose(
  {
    telemetry: createStreamBuilder().streamName("telemetry"),
    ingest: createFunctionBuilder()
      // runtime, handler, code …
      .grant(streamGrants.write(ref<StreamBuilderResult>("telemetry").get("stream"))),
  },
  { telemetry: [], ingest: ["telemetry"] },
);
```

## Constraints

`streamName` is validated at build against the [CreateStream](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_CreateStream.html) rules — 1 to 128 characters from `[a-zA-Z0-9_.-]` — so a bad name fails at `cdk synth` rather than at deploy ([ADR-0010](../../docs/adr/0010-aws-property-constraints.md)). The validator is exported for direct use:

```ts
import { constraints } from "@composurecdk/kinesis";

constraints.validate.streamName("telemetry"); // throws on an invalid name
```

## Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis) by default. Alarms are returned in the build result as `Record<string, Alarm>`, keyed as below. No alarm actions are configured — apply them from the result or with [`alarmActionsPolicy`](../cloudwatch/README.md).

Every alarm uses a 1-minute period and treats missing data as not breaching: producer and consumer metrics are only emitted while the API is called, so an idle stream has no data rather than bad data.

| Alarm                                | Metric                                     | Default threshold                                   | On  | Rationale                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRecordsIteratorAgeMilliseconds`  | `GetRecords.IteratorAgeMilliseconds` (Max) | > 50% of `retentionPeriod`, in ms; 15 of 15 minutes | yes | A consumer half-way through the retention window is at risk of reading records Kinesis has already deleted. Derived, so it stays right when retention changes. |
| `readProvisionedThroughputExceeded`  | `ReadProvisionedThroughputExceeded` (Avg)  | > 0.01; 5 of 5 minutes                              | yes | Sustained read throttling: consumers fall behind.                                                                                                              |
| `writeProvisionedThroughputExceeded` | `WriteProvisionedThroughputExceeded` (Avg) | > 0.01; 5 of 5 minutes                              | yes | Sustained write throttling: producers must retry, or drop records.                                                                                             |
| `putRecordSuccess`                   | `PutRecord.Success` (Avg)                  | < 0.99; 5 of 5 minutes                              | yes | Fewer than 99% of `PutRecord` calls succeed.                                                                                                                   |
| `getRecordsSuccess`                  | `GetRecords.Success` (Avg)                 | < 0.99; 5 of 5 minutes                              | yes | Fewer than 99% of `GetRecords` calls succeed.                                                                                                                  |
| `putRecordsFailedRecords`            | `PutRecords.FailedRecords` (Sum)           | none — you supply it; 5 of 5 minutes                | no  | Occasional internal failures are expected and retried; how many a workload tolerates depends on its volume.                                                    |

The two throughput-exceeded alarms stay on for on-demand streams (the default). On-demand capacity still throttles traffic that more than doubles the stream's previous peak within 15 minutes, and a single partition key is still bound by one shard's write limit, so a hot key throttles however the stream scales ([capacity modes](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html)).

The iterator-age threshold is derived from the stream's merged `retentionPeriod` — 302,400,000 ms (3.5 days) for the default 168 hours. A `threshold` you supply wins. When the retention period is an unresolved token (e.g. a `CfnParameter`), there is nothing to derive from, so the alarm is skipped with an acknowledgeable warning (`@composurecdk/kinesis:iterator-age-alarm-token-retention`) unless you supply a threshold. Consumer-lag SLAs are workload-specific; a Lambda consumer's own `IteratorAge` alarm covers those.

`PutRecords.FailedRecords` has no generic threshold, so enabling it without one throws at build:

```ts
createStreamBuilder().recommendedAlarms({ putRecordsFailedRecords: { threshold: 100 } });
```

The defaults are exported as `STREAM_ALARM_DEFAULTS` for visibility and testing.

### Customizing and disabling alarms

`recommendedAlarms` takes a `StreamAlarmConfig` or `false`. Override any field of an individual alarm, set an alarm to `false` to disable it, or set `recommendedAlarms` to `false` (or `{ enabled: false }`) to turn off the recommended set. Custom alarms are still created.

```ts
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";

const telemetry = createStreamBuilder()
  .streamName("telemetry")
  .recommendedAlarms({
    getRecordsIteratorAgeMilliseconds: { threshold: 60_000 },
    putRecordSuccess: { evaluationPeriods: 10, treatMissingData: TreatMissingData.MISSING },
    getRecordsSuccess: false,
  });
```

### Custom alarms

Add custom alarms via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `IStream`, so the metric factory has access to the stream's properties.

```ts
import { Duration } from "aws-cdk-lib";

const telemetry = createStreamBuilder()
  .streamName("telemetry")
  .addAlarm("noIncomingRecords", (alarm) =>
    alarm
      .metric((stream) => stream.metricIncomingRecords({ period: Duration.minutes(5) }))
      .threshold(1)
      .lessThan()
      .description("No telemetry has arrived in five minutes."),
  );
```
