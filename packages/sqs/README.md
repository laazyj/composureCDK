# @composurecdk/sqs

SQS queue builders for [ComposureCDK](../../README.md).

This package provides fluent builders for SQS queues with secure, AWS-recommended defaults and built-in CloudWatch alarms. They wrap the CDK [Queue](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Choosing a builder

Standard, FIFO, and dead-letter queues have distinct — and partly mutually exclusive — recommended configurations and alarms, so each has its own entry point with a prop surface restricted to what applies:

| Builder                  | Queue type        | Distinct behaviour                                                                                                                      |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `createQueueBuilder`     | Standard, primary | FIFO-only props are excluded from the type (and rejected at build).                                                                     |
| `createFifoQueueBuilder` | FIFO, primary     | `fifo: true` always; `queueName` typed to require the `.fifo` suffix; high-throughput mode validated.                                   |
| `createDlqQueueBuilder`  | Dead-letter       | 14-day retention; inverted alarm set (any message alerts); `deadLetterQueue` excluded — a DLQ is terminal. Supports `.fifo(true)` DLQs. |

All three share the same [secure defaults](#secure-defaults), the same `Lifecycle`/`compose` integration, the same `addAlarm` escape hatch, and the same `QueueBuilderResult` shape.

## Queue Builder (standard)

```ts
import { Duration } from "aws-cdk-lib";
import { createQueueBuilder } from "@composurecdk/sqs";

const orders = createQueueBuilder()
  .queueName("orders")
  .visibilityTimeout(Duration.seconds(60))
  .build(stack, "Orders");
```

Every [QueueProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.QueueProps.html) property except the FIFO-only ones (`fifo`, `contentBasedDeduplication`, `deduplicationScope`, `fifoThroughputLimit`) is available as a fluent setter. Setting a FIFO-only prop is a compile error — and a build-time error for untyped callers — pointing at `createFifoQueueBuilder` instead.

## FIFO Queue Builder

```ts
import { DeduplicationScope, FifoThroughputLimit } from "aws-cdk-lib/aws-sqs";
import { createFifoQueueBuilder } from "@composurecdk/sqs";

const orderEvents = createFifoQueueBuilder()
  .queueName("order-events.fifo") // type requires the `.fifo` suffix
  .contentBasedDeduplication(true)
  .build(stack, "OrderEvents");

// High-throughput FIFO — the dedup scope pairing is validated at build.
const highTps = createFifoQueueBuilder()
  .queueName("order-events-ht.fifo")
  .fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID)
  .deduplicationScope(DeduplicationScope.MESSAGE_GROUP)
  .build(stack, "OrderEventsHt");
```

FIFO-aware behaviour:

- **`fifo: true` always.** The prop is not settable; the builder's identity is the switch.
- **`queueName` is typed `` `${string}.fifo` ``** — AWS requires the suffix, so a bad name fails at compile time instead of synth. Omit the name to let CloudFormation generate a valid one.
- **High-throughput coherence**: `fifoThroughputLimit: PER_MESSAGE_GROUP_ID` without `deduplicationScope: MESSAGE_GROUP` throws at build ([high-throughput FIFO](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html)).
- **Redrive type match**: a FIFO queue redriving to a standard DLQ (or vice versa on the standard builder) throws at build — AWS rejects the mismatch at deploy time otherwise.
- **Alarms**: same set and thresholds as the standard builder. Since [November 2024](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-sqs-increases-in-flight-limit-fifo-queues/) FIFO queues share the standard 120,000 in-flight quota, so the in-flight threshold applies unchanged. Note that FIFO throughput ceilings (300 TPS, or 3,000 with high-throughput mode) are account-level behaviour with no dedicated CloudWatch metric — if you need a "throughput wall" signal, add a custom alarm on `NumberOfMessagesSent` via `addAlarm`.

## Dead-Letter Queue Builder

```ts
import { compose, ref } from "@composurecdk/core";
import { createDlqQueueBuilder, createQueueBuilder } from "@composurecdk/sqs";

const system = compose(
  {
    ordersDlq: createDlqQueueBuilder(),
    orders: createQueueBuilder().deadLetterQueue(
      ref("ordersDlq", (r) => ({ queue: r.queue, maxReceiveCount: 5 })),
    ),
  },
  { ordersDlq: [], orders: ["ordersDlq"] },
);
```

DLQ-specific behaviour:

| Property          | Default             | Rationale                                                                                                                                                                    |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retentionPeriod` | `Duration.days(14)` | The SQS maximum. A DLQ exists to give operators a window to investigate and redrive failed messages — maximizing that window is the point. Exported as `DLQ_QUEUE_DEFAULTS`. |

- **`deadLetterQueue` is excluded** from the type (and rejected at build): a DLQ is the terminal destination for failed messages. A queue with its own redrive policy is a primary queue.
- **FIFO DLQs**: AWS requires a FIFO source queue's DLQ to itself be FIFO, so the FIFO props remain available here — `createDlqQueueBuilder().fifo(true).queueName("orders-dlq.fifo")` — with the same suffix and high-throughput validation as the FIFO builder.
- Consider restricting which queues may redrive into the DLQ via `.redriveAllowPolicy(...)`.

### DLQ alarms

The recommended-alarm set inverts relative to a primary queue — the defaults are exported as `DLQ_ALARM_DEFAULTS`:

| Alarm                                   |   Default on a DLQ    | Rationale                                                                                                                                                                                                                                                                  |
| --------------------------------------- | :-------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approximateNumberOfMessagesVisible`    |       ✅ (> 0)        | Any message on a DLQ indicates a delivery failure that needs investigation.                                                                                                                                                                                                |
| `approximateAgeOfOldestMessage`         | ✅ (75% of retention) | Nothing consumes a DLQ, so "consumer falling behind" is meaningless — instead this is the last call to investigate before SQS silently deletes the message at `retentionPeriod`. The threshold scales with the queue's actual retention (`DLQ_AGE_ALARM_RETENTION_RATIO`). |
| `approximateNumberOfMessagesNotVisible` |          ❌           | Nothing is normally in flight on a DLQ. Opt back in via `recommendedAlarms` if you have a reason to watch it.                                                                                                                                                              |

Every entry is individually overridable through the same `recommendedAlarms` API used for primary queues:

```ts
const ordersDlq = createDlqQueueBuilder()
  .recommendedAlarms({
    approximateNumberOfMessagesVisible: { threshold: 5 }, // alert only once a small backlog builds
    approximateAgeOfOldestMessage: false, // rely on the visible-messages alarm alone
  })
  .build(stack, "OrdersDlq");
```

## Secure Defaults

All three builders apply the following defaults. Each can be overridden via the builder's fluent API.

| Property                 | Default                       | Rationale                                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforceSSL`             | `true`                        | Denies any request that doesn't use TLS (resource policy `Deny` on `aws:SecureTransport: false`). Mirrors the SNS topic default. ([SNS/SQS security best practices](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-security-best-practices.html)) |
| `encryption`             | `QueueEncryption.SQS_MANAGED` | Encrypts at rest with the SQS-managed key (SSE-SQS). KMS encryption is opt-in via `.encryption(QueueEncryption.KMS)` + `.encryptionMasterKey(key)`. ([SQS data protection](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-data-protection.html))  |
| `receiveMessageWaitTime` | `Duration.seconds(20)`        | Enables [long polling](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html#sqs-long-polling) — fewer empty receives, lower cost, lower latency. 20s is the SQS maximum.                                                    |

`visibilityTimeout` is intentionally not defaulted — it must match the longest consumer processing time, which is workload-specific. `retentionPeriod` is left at CDK's default of 4 days on the primary builders (the DLQ builder raises it to 14 days, see above).

The defaults are exported as `QUEUE_DEFAULTS` (shared) and `DLQ_QUEUE_DEFAULTS` (the DLQ layer) for visibility and testing:

```ts
import { DLQ_QUEUE_DEFAULTS, QUEUE_DEFAULTS } from "@composurecdk/sqs";
```

### Overriding defaults

```ts
const queue = createQueueBuilder()
  .queueName("my-queue")
  .enforceSSL(false)
  .receiveMessageWaitTime(Duration.seconds(0))
  .build(stack, "MyQueue");
```

## Recommended Alarms

The builders create [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

On the primary builders (`createQueueBuilder`, `createFifoQueueBuilder`):

| Alarm                                   | Metric                                               | Default threshold | Rationale                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approximateAgeOfOldestMessage`         | `ApproximateAgeOfOldestMessage` (Max, 1 min)         | > 300s (5 min)    | Primary "consumer falling behind" signal. Conservative starting point — tune to your SLA and `retentionPeriod`.                                                                                               |
| `approximateNumberOfMessagesNotVisible` | `ApproximateNumberOfMessagesNotVisible` (Max, 1 min) | > 90,000          | 75% of the [120k in-flight messages](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/quotas-messages.html#quotas-in-flight) per-queue quota. Proactive guardrail before receives are rejected. |

The third AWS-recommended SQS alarm, `ApproximateNumberOfMessagesVisible`, is not enabled by default on a primary queue — its useful threshold depends entirely on the application's processing capacity, and any generic value would be either noise or silence. Enable it explicitly via `recommendedAlarms` with your own threshold. On a dead-letter queue it is on by default with threshold > 0 (see [DLQ alarms](#dlq-alarms)).

The defaults are exported as `QUEUE_ALARM_DEFAULTS` (primary) and `DLQ_ALARM_DEFAULTS` (dead-letter) for visibility and testing:

```ts
import { DLQ_ALARM_DEFAULTS, QUEUE_ALARM_DEFAULTS } from "@composurecdk/sqs";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const queue = createQueueBuilder()
  .queueName("orders")
  .recommendedAlarms({
    approximateAgeOfOldestMessage: { threshold: 60, evaluationPeriods: 3 },
  });
```

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ approximateNumberOfMessagesNotVisible: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm` (available on every builder). The callback receives an `AlarmDefinitionBuilder` typed to `IQueue`, so the metric factory has access to the queue's properties.

```ts
import { Duration } from "aws-cdk-lib";

const queue = createQueueBuilder()
  .queueName("orders")
  .addAlarm("highEmptyReceiveRate", (alarm) =>
    alarm
      .metric((queue) => queue.metricNumberOfEmptyReceives({ period: Duration.minutes(1) }))
      .threshold(1000)
      .greaterThan()
      .description("Queue receiving an unusually high number of empty receives."),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = createQueueBuilder().queueName("orders").build(stack, "Orders");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

For composing the alarm-actions wiring across multiple builders in a single `compose` system, see [`alarmActionsPolicy`](../cloudwatch/README.md) in `@composurecdk/cloudwatch`.

## Examples

- [OrderProcessorStack](../examples/src/order-processor-app.ts) — Primary SQS queue with recommended alarms routed to a sibling SNS alert topic.
