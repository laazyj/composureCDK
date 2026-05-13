# @composurecdk/sqs

SQS queue builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for SQS queues with secure, AWS-recommended defaults and built-in CloudWatch alarms. It wraps the CDK [Queue](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.Queue.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Queue Builder

```ts
import { Duration } from "aws-cdk-lib";
import { createQueueBuilder } from "@composurecdk/sqs";

const orders = createQueueBuilder()
  .queueName("orders")
  .visibilityTimeout(Duration.seconds(60))
  .build(stack, "Orders");
```

Every [QueueProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sqs.QueueProps.html) property is available as a fluent setter on the builder. FIFO queues are supported via the standard `fifo`, `contentBasedDeduplication`, and `fifoThroughputLimit` props — no FIFO-specific defaults are applied.

## Secure Defaults

`createQueueBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                 | Default                       | Rationale                                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforceSSL`             | `true`                        | Denies any request that doesn't use TLS (resource policy `Deny` on `aws:SecureTransport: false`). Mirrors the SNS topic default. ([SNS/SQS security best practices](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-security-best-practices.html)) |
| `encryption`             | `QueueEncryption.SQS_MANAGED` | Encrypts at rest with the SQS-managed key (SSE-SQS). KMS encryption is opt-in via `.encryption(QueueEncryption.KMS)` + `.encryptionMasterKey(key)`. ([SQS data protection](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-data-protection.html))  |
| `receiveMessageWaitTime` | `Duration.seconds(20)`        | Enables [long polling](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html#sqs-long-polling) — fewer empty receives, lower cost, lower latency. 20s is the SQS maximum.                                                    |

`visibilityTimeout` is intentionally not defaulted — it must match the longest consumer processing time, which is workload-specific. `retentionPeriod` is also left at CDK's default of 4 days; bump it to 14 days if you need a longer replay window.

The defaults are exported as `QUEUE_DEFAULTS` for visibility and testing:

```ts
import { QUEUE_DEFAULTS } from "@composurecdk/sqs";
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

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm                                   | Metric                                               | Default threshold | Rationale                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approximateAgeOfOldestMessage`         | `ApproximateAgeOfOldestMessage` (Max, 1 min)         | > 300s (5 min)    | Primary "consumer falling behind" signal. Conservative starting point — tune to your SLA and `retentionPeriod`.                                                                                               |
| `approximateNumberOfMessagesNotVisible` | `ApproximateNumberOfMessagesNotVisible` (Max, 1 min) | > 90,000          | 75% of the [120k in-flight messages](https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/quotas-messages.html#quotas-in-flight) per-queue quota. Proactive guardrail before receives are rejected. |

These defaults target primary queues; dead-letter queues need different thresholds (any message on a DLQ is itself an alert).

The third AWS-recommended SQS alarm, `ApproximateNumberOfMessagesVisible`, is not enabled by default — its useful threshold depends entirely on the application's processing capacity, and any generic value would be either noise or silence. Use `addAlarm` (see [Custom alarms](#custom-alarms)) to add it for workloads where you know the right threshold.

The defaults are exported as `QUEUE_ALARM_DEFAULTS` for visibility and testing:

```ts
import { QUEUE_ALARM_DEFAULTS } from "@composurecdk/sqs";
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

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `IQueue`, so the metric factory has access to the queue's properties.

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
