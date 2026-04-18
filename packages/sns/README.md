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

[^dlq]: Metric only emits when a subscription on the topic has a dead-letter queue attached and SNS attempts redrive. `TreatMissingData` defaults to `notBreaching`, so the alarm stays quiet on topics without DLQs. Attach a DLQ via the `SubscriptionBuilder`'s `.deadLetterQueue(...)` — see [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html).

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

## Subscription Builder

```ts
import { createSubscriptionBuilder } from "@composurecdk/sns";
import { SubscriptionProtocol } from "aws-cdk-lib/aws-sns";

const emailAlerts = createSubscriptionBuilder()
  .topic(budgetTopic)
  .protocol(SubscriptionProtocol.EMAIL)
  .endpoint("ops@example.com")
  .build(stack, "BudgetEmailSubscription");
```

Every [SubscriptionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.SubscriptionProps.html) property is available as a fluent setter. `topic` and `deadLetterQueue` additionally accept a `Ref` so the subscription can be composed with a `TopicBuilder` (or any other component) without post-build wiring:

```ts
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder, createSubscriptionBuilder } from "@composurecdk/sns";
import { SubscriptionProtocol } from "aws-cdk-lib/aws-sns";

const system = compose(
  {
    budget: createTopicBuilder().topicName("budget-alerts"),
    email: createSubscriptionBuilder()
      .topic(ref("budget", (r) => r.topic))
      .protocol(SubscriptionProtocol.EMAIL)
      .endpoint("ops@example.com"),
  },
  { budget: [], email: ["budget"] },
);
```

### Subscription reliability

Attaching a dead-letter queue is the primary reliability control for SNS subscriptions ([AWS Well-Architected — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html), [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)). Pass a queue via `.deadLetterQueue(queue)` or a `ref` to one; the builder does not create a DLQ automatically because the queue resource needs to be caller-owned.

The CloudWatch metrics that surface delivery failures (`NumberOfNotificationsRedrivenToDlq`, `NumberOfNotificationsFailedToRedriveToDlq`) are topic-level, so the recommended alarms for them live on the `TopicBuilder` (see [Recommended Alarms](#recommended-alarms) above) and only report data once at least one subscription has a DLQ attached.

Also note: `SubscriptionProtocol.HTTP` is allowed for compatibility; prefer `HTTPS` for transport encryption ([SNS security best practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html)).

## Examples

- [LambdaApiStack](../examples/src/lambda-api-app.ts) — REST API with TopicBuilder for alarm actions
- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with TopicBuilder for alarm actions
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — Static website with TopicBuilder for alarm actions
