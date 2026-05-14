# @composurecdk/sns

SNS topic and subscription builders for [ComposureCDK](../../README.md).

This package provides fluent builders for SNS topics and subscriptions with secure, AWS-recommended defaults. They wrap the CDK [Topic](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html) and [Subscription](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Subscription.html) constructs — refer to the CDK documentation for the full set of configurable properties.

## Topic Builder

```ts
import { createTopicBuilder } from "@composurecdk/sns";

const alerts = createTopicBuilder()
  .topicName("my-alerts")
  .displayName("My Alert Topic")
  .build(stack, "AlertTopic");
```

Every [TopicProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.TopicProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createTopicBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property     | Default | Rationale                                                                     |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| `enforceSSL` | `true`  | Denies publish/subscribe requests that do not use TLS (transport encryption). |

These defaults are guided by the [AWS SNS Security Best Practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit).

The defaults are exported as `TOPIC_DEFAULTS` for visibility and testing:

```ts
import { TOPIC_DEFAULTS } from "@composurecdk/sns";
```

### Overriding defaults

```ts
const topic = createTopicBuilder().topicName("my-topic").enforceSSL(false).build(stack, "MyTopic");
```

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm                                               | Metric                                                          | Default threshold | Created when |
| --------------------------------------------------- | --------------------------------------------------------------- | ----------------- | ------------ |
| `numberOfNotificationsFailed`                       | NumberOfNotificationsFailed (Sum, 1 min)                        | > 0               | Always       |
| `numberOfNotificationsFilteredOutInvalidAttributes` | NumberOfNotificationsFilteredOut-InvalidAttributes (Sum, 1 min) | > 0               | Always       |
| `numberOfNotificationsRedrivenToDlq`                | NumberOfNotificationsRedrivenToDlq (Sum, 1 min)                 | > 0               | Always[^dlq] |
| `numberOfNotificationsFailedToRedriveToDlq`         | NumberOfNotificationsFailedToRedriveToDlq (Sum, 1 min)          | > 0               | Always[^dlq] |

[^dlq]: Metric only emits when a subscription on the topic has a dead-letter queue attached and SNS attempts redrive. `TreatMissingData` defaults to `notBreaching`, so the alarm stays quiet on topics without DLQs. Attach a DLQ on the `ITopicSubscription` itself (e.g. `new LambdaSubscription(fn, { deadLetterQueue: dlq })`) — see [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html).

The defaults are exported as `TOPIC_ALARM_DEFAULTS` for visibility and testing:

```ts
import { TOPIC_ALARM_DEFAULTS } from "@composurecdk/sns";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const topic = createTopicBuilder()
  .topicName("my-topic")
  .recommendedAlarms({
    numberOfNotificationsFailed: { threshold: 5, evaluationPeriods: 3 },
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
builder.recommendedAlarms({ numberOfNotificationsFailed: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `ITopic`, so the metric factory has access to the topic's properties.

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

const topic = createTopicBuilder()
  .topicName("my-topic")
  .addAlarm("highPublishRate", (alarm) =>
    alarm
      .metric(
        (topic) =>
          new Metric({
            namespace: "AWS/SNS",
            metricName: "NumberOfMessagesPublished",
            dimensionsMap: { TopicName: topic.topicName },
            statistic: "Sum",
            period: Duration.minutes(1),
          }),
      )
      .threshold(10000)
      .greaterThanOrEqual()
      .description("Topic receiving unusually high message volume"),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = topic.build(stack, "MyTopic");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## Adding Subscriptions to a Topic

For the common case where a topic and its subscriptions are declared together, use `addSubscription` on the topic builder. It accepts any CDK [`ITopicSubscription`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.ITopicSubscription.html) (e.g. `EmailSubscription`, `LambdaSubscription`, `SqsSubscription`) and binds it via `ITopicSubscription.bind(topic)` — the same path CDK uses for `topic.addSubscription(...)`, so endpoint-specific wire-up (Lambda invoke permission, SQS queue policy, KMS decrypt policy) happens automatically.

```ts
import { createTopicBuilder } from "@composurecdk/sns";
import { EmailSubscription, LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

const result = createTopicBuilder()
  .topicName("alerts")
  .addSubscription("ops", new EmailSubscription("ops@example.com"))
  .addSubscription("handler", new LambdaSubscription(alertHandler))
  .build(stack, "Alerts");

result.subscriptions.ops; // AWS SNS Subscription construct
```

Each subscription is exposed on `result.subscriptions` under the key supplied to `addSubscription`.

Cross-component subscriptions can be declared with `ref(...)` inside a [`compose`](../core/README.md) system, so the subscription's endpoint is resolved from another component's build output at build time:

```ts
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder } from "@composurecdk/sns";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

const system = compose(
  {
    handler: createFunctionBuilder()./* ... */,
    alerts: createTopicBuilder().addSubscription(
      "handler",
      ref("handler", (r: FunctionBuilderResult) => new LambdaSubscription(r.function)),
    ),
  },
  { handler: [], alerts: ["handler"] },
);
```

## Subscription Builder

Use `createSubscriptionBuilder` when subscribing to a **foreign** topic — one that is not built in the same `compose` system (for example, a topic owned by another stack or account). When the topic and its subscriptions are declared together, prefer [`TopicBuilder.addSubscription`](#adding-subscriptions-to-a-topic) instead.

```ts
import { createSubscriptionBuilder } from "@composurecdk/sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

const emailAlerts = createSubscriptionBuilder()
  .topic(budgetTopic)
  .subscription(new EmailSubscription("ops@example.com"))
  .build(stack, "BudgetEmailSubscription");
```

The builder accepts any CDK [`ITopicSubscription`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.ITopicSubscription.html) (e.g. `EmailSubscription`, `LambdaSubscription`, `SqsSubscription`) and binds it via `ITopicSubscription.bind(topic)` — the same path CDK uses for `topic.addSubscription(...)`, so endpoint-specific wire-up (Lambda invoke permission, SQS queue policy, KMS decrypt grant) happens automatically. Subscription-specific options — dead-letter queue, filter policy, raw message delivery — are configured on the `ITopicSubscription` itself, matching CDK's own API:

```ts
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

createSubscriptionBuilder()
  .topic(orderEventsTopic)
  .subscription(
    new LambdaSubscription(handler, {
      deadLetterQueue: dlq,
      filterPolicy: { severity: SubscriptionFilter.stringFilter({ allowlist: ["HIGH"] }) },
    }),
  )
  .build(stack, "OrderEventsHandler");
```

Both `.topic(...)` and `.subscription(...)` accept a `Ref`, so the builder composes cleanly with a `TopicBuilder` — or with any other component that produces the endpoint resource:

```ts
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder, createSubscriptionBuilder } from "@composurecdk/sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

const system = compose(
  {
    budget: createTopicBuilder().topicName("budget-alerts"),
    email: createSubscriptionBuilder()
      .topic(ref("budget", (r) => r.topic))
      .subscription(new EmailSubscription("ops@example.com")),
  },
  { budget: [], email: ["budget"] },
);
```

### Subscription reliability

Attaching a dead-letter queue is the primary reliability control for SNS subscriptions ([AWS Well-Architected — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html), [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)). Pass a queue to the `ITopicSubscription` constructor (e.g. `new EmailSubscription("ops@example.com", { deadLetterQueue: dlq })`); the builder does not create a DLQ automatically because the queue resource needs to be caller-owned.

The CloudWatch metrics that surface delivery failures (`NumberOfNotificationsRedrivenToDlq`, `NumberOfNotificationsFailedToRedriveToDlq`) are topic-level, so the recommended alarms for them live on the `TopicBuilder` (see [Recommended Alarms](#recommended-alarms) above) and only report data once at least one subscription has a DLQ attached.

## Subscription Defaults

Both `createSubscriptionBuilder` and `TopicBuilder.addSubscription` apply per-protocol defaults to the `TopicSubscriptionConfig` returned by `ITopicSubscription.bind(topic)`. Defaults are gap-filling: anything the `ITopicSubscription` itself configured (via its constructor options) wins; defaults only apply where the bound config left a field unset.

| Protocol   | Default                    | Rationale                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQS`      | `rawMessageDelivery: true` | Removes the SNS envelope so downstream SQS consumers see the publisher's payload as-is — fewer bytes, no parse step. The typical choice for SNS → SQS fan-out.                                                                                                              |
| `FIREHOSE` | `rawMessageDelivery: true` | Stores records as the publisher sent them rather than wrapped in an SNS envelope.                                                                                                                                                                                           |
| `HTTP`     | _(no default applied)_     | Emits a synth-time warning instead — plain HTTP delivery means messages and signed-confirmation tokens travel unencrypted. Prefer `SubscriptionProtocol.HTTPS`. ([SNS security best practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html)) |

`LAMBDA` is intentionally absent — SNS does not support raw delivery to Lambda subscriptions; the handler always receives the SNS envelope. Other protocols (HTTPS, EMAIL, EMAIL_JSON, SMS, APPLICATION) receive no overrides.

These defaults are guided by [SNS raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html) and the [AWS SNS security best practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html).

The map is exported as `SUBSCRIPTION_DEFAULTS` for visibility and testing:

```ts
import { SUBSCRIPTION_DEFAULTS } from "@composurecdk/sns";
```

### Overriding a default

Any default is individually overridable through the `ITopicSubscription`'s own constructor options:

```ts
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

createSubscriptionBuilder()
  .topic(orders)
  .subscription(new SqsSubscription(queue, { rawMessageDelivery: false }))
  .build(stack, "OrdersToQueue");
```

## Examples

- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with TopicBuilder for alarm actions
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — Static website with TopicBuilder for alarm actions
