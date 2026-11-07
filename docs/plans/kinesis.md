# Plan: Kinesis Data Streams support (#120)

> **Review-only.** This document is raised as a PR for discussion and is not
> intended to merge. The implementation lands as the PR stack described in
> [Delivery](#delivery).

## Goal

Add `@composurecdk/kinesis` so a Kinesis data stream is a first-class composed
component: a `createStreamBuilder()` with well-architected defaults, AWS-recommended
alarms, consumer-side grants and `ref()`-aware composition. Then close the loop
#118 deferred: a `kinesisEventSource()` helper and the `IteratorAge` contextual
alarm for Kinesis in `@composurecdk/lambda`.

Out of scope (follow-ons): Amazon Data Firehose, Managed Service for Apache Flink,
an EventBridge `KinesisStream` target wrapper in `@composurecdk/events`, and
account-level On-demand Advantage / warm throughput.

## Sources

Defaults and alarms are traced to these AWS sources. Each `DEFAULT_*` constant
carries the `@see` link in its JSDoc, per [architecture.md](../architecture.md#defaults).

| Topic                                            | Source                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encryption at rest (Security Hub **Kinesis.1**)  | [Security Hub Kinesis controls](https://docs.aws.amazon.com/securityhub/latest/userguide/kinesis-controls.html), Config rule `kinesis-stream-encrypted`                                                                                                                                                                                  |
| Retention ≥ 168 h (Security Hub **Kinesis.3**)   | [kinesis-stream-backup-retention-check](https://docs.aws.amazon.com/config/latest/developerguide/kinesis-stream-backup-retention-check.html) (`minimumBackupRetentionPeriod`, default 168)                                                                                                                                               |
| SSE costs / AWS-managed key is free              | [Costs and performance of SSE](https://docs.aws.amazon.com/streams/latest/dev/costs-performance.html)                                                                                                                                                                                                                                    |
| CMK key-policy scoping                           | [Permissions to use user-generated KMS keys](https://docs.aws.amazon.com/streams/latest/dev/permissions-user-key-KMS.html)                                                                                                                                                                                                               |
| Resource-based policies (actions, EFO, regions)  | [Controlling access](https://docs.aws.amazon.com/streams/latest/dev/controlling-access.html)                                                                                                                                                                                                                                             |
| TLS 1.2 required                                 | [Infrastructure security](https://docs.aws.amazon.com/streams/latest/dev/infrastructure-security.html)                                                                                                                                                                                                                                   |
| Capacity modes                                   | [Choose the data stream capacity mode](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html)                                                                                                                                                                                                                       |
| Recommended alarms                               | [CloudWatch recommended alarms — Kinesis](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Kinesis)                                                                                                                                                                     |
| Iterator age vs. retention ("risk of data loss") | [Monitoring with CloudWatch](https://docs.aws.amazon.com/streams/latest/dev/monitoring-with-cloudwatch.html)                                                                                                                                                                                                                             |
| Enhanced fan-out                                 | [Develop enhanced fan-out consumers](https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html)                                                                                                                                                                                                                             |
| Lambda ESM error handling                        | [Lambda Kinesis parameters](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-parameters.html), [batch item failures](https://docs.aws.amazon.com/lambda/latest/dg/services-kinesis-batchfailurereporting.html), [on-failure destinations](https://docs.aws.amazon.com/lambda/latest/dg/kinesis-on-failure-destination.html) |
| Lambda consumer tuning                           | [Best practices for consuming Kinesis with Lambda](https://aws.amazon.com/blogs/big-data/best-practices-for-consuming-amazon-kinesis-data-streams-using-aws-lambda/)                                                                                                                                                                     |
| Pricing (extended retention, on-demand)          | [Kinesis Data Streams pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)                                                                                                                                                                                                                                                     |

> **Verification caveat.** `docs.aws.amazon.com` was not reachable from the
> planning session, so the alarm-page details below come from search excerpts
> and recall of the page, not a fresh read. Thresholds marked † should be
> checked against the live page during review.

## Package: `@composurecdk/kinesis`

Shape mirrors `@composurecdk/sqs` / `@composurecdk/sns`:

```
packages/kinesis/src/
  index.ts
  defaults.ts                    STREAM_DEFAULTS
  stream-builder.ts              createStreamBuilder()
  stream-alarm-config.ts         StreamAlarmConfig
  stream-alarm-defaults.ts       STREAM_ALARM_DEFAULTS
  stream-alarms.ts               createStreamAlarms()
  stream-consumer-builder.ts     createStreamConsumerBuilder()
  stream-consumer-alarm-*.ts     consumer (EFO) alarm config/defaults/alarms
  grants.ts                      streamGrants, streamConsumerGrants
  stream-name.ts                 constraints.validate.streamName (ADR-0010)
```

### `createStreamBuilder()`

- Tagged builder (`taggedBuilder`, `builder-must-be-tagged`), `COPY_STATE` for
  custom alarms, `addAlarm()`.
- `encryptionKey` re-declared as
  `Resolvable<NonNullable<StreamProps["encryptionKey"]>>` (ADR-0018) so a composed
  `@composurecdk/kms` key wires in by `ref()`.
- `recommendedAlarms?: StreamAlarmConfig | false`.
- **Result** (complete per architecture.md):
  `{ stream: Stream; alarms: Record<string, Alarm>; key?: IKey; policy?: ResourcePolicy }`.
  `key` is the stream's encryption key when it is customer-managed, which includes
  the key CDK auto-creates for `encryption: KMS` without a key. `policy` is the
  stream's resource policy if one exists at build time, located the way the SNS
  builder finds `TopicPolicy` (L1 type check, no `instanceof`).

### Defaults (`STREAM_DEFAULTS`)

| Prop              | Default                    | CDK default                                                 | Why                                                                                                                                                        |
| ----------------- | -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encryption`      | `StreamEncryption.MANAGED` | `alias/aws/kinesis`, gated by a China-region `CfnCondition` | Satisfies Kinesis.1 at no key cost and needs no extra grants. Explicit, so the template has no region `CfnCondition` and stays stable across CDK versions. |
| `streamMode`      | `StreamMode.ON_DEMAND`     | `PROVISIONED`, 1 shard                                      | AWS positions on-demand for new or unpredictable workloads. No shard maths, and no silent throttling on a 1 MB/s single shard. **See decision D1.**        |
| `retentionPeriod` | `Duration.hours(168)`      | 24 h                                                        | Kinesis.3 fails anything under 168 h. It also gives a consumer outage a week of replay instead of a day. **Costs money — see decision D2.**                |
| `removalPolicy`   | `RemovalPolicy.RETAIN`     | `RETAIN`                                                    | Same as CDK; stated explicitly so it is discoverable and stable.                                                                                           |

Not defaulted (opt-in, documented in the README):

- `shardLevelMetrics`. Enhanced monitoring is billed per shard per metric and AWS
  does not recommend it by default.
- Resource policy. Not needed for same-account access. Grants add statements
  automatically for cross-account grantees.
- **No `enforceSSL`.** Kinesis is HTTPS-only (TLS 1.2 required) and its
  resource-policy action list is narrow. AWS documents no `aws:SecureTransport`
  pattern for Kinesis, unlike SQS and SNS, so there is nothing to enforce.

Mutually-exclusive siblings (ADR-0009, the same as `@composurecdk/sqs`):

- Setting `shardCount` drops the `ON_DEMAND` default and implies `PROVISIONED`.
  An explicit `streamMode: ON_DEMAND` together with `shardCount` is left for CDK
  to reject.
- Setting `encryptionKey` drops the `MANAGED` default and implies `KMS`. An
  explicit `encryption` still wins.

### Grants (`grants.ts`, ADR-0013)

`streamGrants.read | write | readWrite` delegate to the L2's native `grant*`,
which also grants `kms:Decrypt` / `kms:GenerateDataKey` when a CMK is in play.
`streamConsumerGrants.read` covers an EFO consumer.

### Recommended alarms (stream)

Pattern: `stream-alarm-config.ts` / `-defaults.ts` / `-alarms.ts`, as in SQS.
Period 60 s throughout. Missing data is `NOT_BREACHING`, because producer and
consumer metrics are absent while nobody calls the API.

| Key                                  | Metric (stat)                              | Default                                                                   | On by default |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------- | ------------- |
| `getRecordsIteratorAgeMilliseconds`  | `GetRecords.IteratorAgeMilliseconds` (Max) | > **50 % of `retentionPeriod`**, 15 of 15 † — derived, see D3             | yes           |
| `readProvisionedThroughputExceeded`  | `ReadProvisionedThroughputExceeded` (Avg)  | > 0.01, 5 of 5 †                                                          | yes           |
| `writeProvisionedThroughputExceeded` | `WriteProvisionedThroughputExceeded` (Avg) | > 0.01, 5 of 5 †                                                          | yes           |
| `putRecordSuccess`                   | `PutRecord.Success` (Avg)                  | < 0.99, 5 of 5 †                                                          | yes           |
| `putRecordsFailedRecords`            | `PutRecords.FailedRecords` (Sum)           | no generic threshold; enabling it without one throws, like SQS `…Visible` | no            |
| `getRecordsSuccess`                  | `GetRecords.Success` (Avg)                 | < 0.99, 5 of 5 †                                                          | yes           |

Throughput-exceeded alarms stay on in on-demand mode too. On-demand still
throttles traffic that more than doubles the previous peak within 15 minutes,
or exceeds the per-partition-key limit.

### `createStreamConsumerBuilder()` (enhanced fan-out)

A separate component, not an `.addConsumer()` on the stream builder. It wires to
the stream by `ref()`, so the consumer is visible in the `compose` graph and can
be placed independently.

- Props: `streamConsumerName`, `stream: Resolvable<IStream>`, `recommendedAlarms`.
- Result: `{ consumer: StreamConsumer; alarms: Record<string, Alarm> }`.
- Alarm: `subscribeToShardEventMillisBehindLatest`, on
  `SubscribeToShardEvent.MillisBehindLatest` (Max, dimensions `StreamName` +
  `ConsumerName`). Default > 60 000 ms, 5 of 5 †, on by default.
- `constraints.validate.streamConsumerName` shares the stream-name pattern
  (`[a-zA-Z0-9_.-]{1,128}`).

### Registration chores

`module-compat` `peerDependencies`; a `cdk-flags.json` `modules` entry
(`"kinesis": ["aws-kinesis"]`). CDK 2.274 ships **no** `aws-kinesis` feature
flags, so `flags` is unchanged. Also: a `cdk-floors.json` entry, measured with
`cdk-floors establish`; the root README package table; the kms README key table;
and `npx nx catalogue` for the two constraints.

**Floor.** `StreamConsumer` arrived between aws-cdk-lib 2.168.0 and 2.180.0
(probed). The consumer builder gates the package floor somewhere in that range.
The exact release is measured during implementation.

## `@composurecdk/lambda`: Kinesis event sources

- `kinesisEventSource(stream: Resolvable<IStream>, props?)` follows
  `dynamoEventSource`. It reuses `DEFAULT_STREAM_EVENT_SOURCE_PROPS`
  (`LATEST`, `reportBatchItemFailures`, `bisectBatchOnError`, ESM metrics).
  `onFailure` is widened to `Resolvable<IQueue | IEventSourceDlq>` via
  `combine`. `startingPosition` is optional.
- `kinesisConsumerEventSource(consumer: Resolvable<IStreamConsumer>, props?)`
  is the EFO variant (`KinesisConsumerEventSource`).
- A new `EventSourceKind` `"kinesis"` joins `STREAM_EVENT_SOURCE_KINDS`, which
  adds the function-level `IteratorAge` alarm. It also reuses
  `guardStreamFailureDestination` (already source-agnostic) and the ESM
  event-count alarm specs.
- No dependency on `@composurecdk/kinesis`; the helpers take aws-cdk-lib types,
  as the DynamoDB helper does.
- **Floor impact.** `KinesisConsumerEventSource` is absent at 2.168.0 and present
  at 2.180.0. Importing it raises `@composurecdk/lambda`'s floor. **See D5.**

## Example (decision D6)

`ComposureCDK-TelemetryPipelineStack` is an IoT telemetry pipeline. Devices
`PutRecord` readings onto an on-demand stream encrypted with a composed CMK.
Two consumers read it:

1. **Latest-reading writer.** A shared-throughput consumer:
   `kinesisEventSource` with bounded retries and an `onFailure` DLQ, writing
   each device's latest reading to DynamoDB.
2. **Anomaly alerter.** An enhanced fan-out consumer
   (`createStreamConsumerBuilder` and `kinesisConsumerEventSource`) that logs
   readings over a threshold.

What it shows that existing examples do not: a stream as a component, EFO
alongside shared-throughput, a CMK reaching producers and consumers through
`streamGrants`, and the stream's alarms.

Smoke test: `PutRecord` a reading, then assert the DynamoDB item and the
alerter's log line. This needs `kinesis:PutRecord` on the OIDC role, scoped to
`ComposureCDK-*` streams. **`github-oidc-role.yml` must be redeployed by hand
before the next `deploy-test`.** `cleanDeskPolicy` gains a `Stream` removal
injector, and `cdk-flags:audit` is re-run.

## Decisions for review

| #   | Decision                                                         | Recommendation                                                                                                                                                                                                                                                                                                                                   | Alternative                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| D1  | Default capacity mode                                            | **On-demand.** Elastic, no shard sizing. It does carry a per-stream-hour charge, roughly $29/month idle against roughly $11 for one provisioned shard.                                                                                                                                                                                           | Keep CDK's provisioned, 1 shard: cheaper idle, but throttles at 1 MB/s or 1000 rec/s writes.  |
| D2  | Default retention                                                | **168 h**, to pass Kinesis.3. Extended retention is billed (about $0.02 per shard-hour provisioned, or per GB-month on-demand).                                                                                                                                                                                                                  | 24 h, the free tier, which fails Kinesis.3.                                                   |
| D3  | Iterator-age threshold                                           | **Derived: 50 % of retention.** This is AWS's own "risk of data loss" line, so it stays correct when retention changes. Consumer _lag_ SLAs are workload-specific and are covered by Lambda's function-level `IteratorAge` alarm (60 s).                                                                                                         | A fixed value such as 60 s: noisy for batch consumers, and meaningless relative to retention. |
| D4  | Lambda Kinesis defaults: bound `retryAttempts` / `maxRecordAge`? | **No default bound**, the same as `dynamoEventSource`. AWS warns that a poison record can block a shard for the whole retention period, but bounding without a DLQ silently drops records. The existing `STREAM_DLQ_WARNING_ID` guard already steers bounded retries toward `onFailure`, and the README will call out the retention interaction. | Default `maxRecordAge` to, say, 1 day and require `onFailure`.                                |
| D5  | Lambda floor raise for EFO                                       | **Accept** the raise from 2.168.0 to the measured `KinesisConsumerEventSource` release (≤ 2.180.0).                                                                                                                                                                                                                                              | Ship only `kinesisEventSource` now and defer EFO, keeping 2.168.0.                            |
| D6  | New example stack                                                | **Add** the telemetry pipeline. EFO and the stream component are not shown anywhere else.                                                                                                                                                                                                                                                        | No example: package README only (cheaper CI, no OIDC redeploy).                               |
| D7  | Consumer as its own builder                                      | **Separate `createStreamConsumerBuilder()`.** The consumer is a CloudFormation resource with its own ARN, alarms and grants.                                                                                                                                                                                                                     | `.addConsumer(name)` on the stream builder, with consumers returned on the stream's result.   |
| D8  | ADR?                                                             | **None.** This applies existing patterns (ADR-0009, -0010, -0011, -0013, -0015, -0018) to a new service.                                                                                                                                                                                                                                         | —                                                                                             |

## Delivery

A stack of PRs, each passing `npx nx verify` on its own. Each build agent runs
`/simplify` before handing back. Nothing is merged.

| PR  | Branch suffix         | Base   | Content                                                                                      |
| --- | --------------------- | ------ | -------------------------------------------------------------------------------------------- |
| 0   | (this PR)             | `main` | This plan.                                                                                   |
| 1   | `-kinesis-1-stream`   | `main` | Package scaffold and registration, `createStreamBuilder`, defaults, grants, name constraint. |
| 2   | `-kinesis-2-alarms`   | PR 1   | Stream recommended alarms.                                                                   |
| 3   | `-kinesis-3-consumer` | PR 2   | `createStreamConsumerBuilder`, consumer grants and alarm.                                    |
| 4   | `-kinesis-4-lambda`   | PR 3   | `kinesisEventSource`, `kinesisConsumerEventSource`, `IteratorAge` kind, floor raise.         |
| 5   | `-kinesis-5-example`  | PR 4   | Telemetry pipeline example, smoke test, OIDC grant, clean-desk injector, flags audit.        |

PRs 1 and 4 are built in parallel; PR 4 needs no kinesis package. PRs 2 and 3
are built in parallel on PR 1, then restacked.
