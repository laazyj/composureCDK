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

### Subscription defaults

`createSubscriptionBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property             | Default | Rationale                                                                                                 |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `rawMessageDelivery` | `false` | Explicit default; raw delivery is protocol-specific and opt-in (valid for HTTP/S, SQS, Lambda, Firehose). |

Deliberately **not** defaulted:

- **Dead-letter queue.** Attaching a DLQ is the primary reliability control for SNS subscriptions ([AWS Well-Architected — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html), [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)) but requires a queue resource the caller owns. Pass one via `.deadLetterQueue(queue)` or a `ref`.
- **HTTPS over HTTP.** `SubscriptionProtocol.HTTP` is allowed for backwards compatibility; prefer `HTTPS` for transport encryption ([SNS security best practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html)).

The defaults are exported as `SUBSCRIPTION_DEFAULTS` for visibility and testing:

```ts
import { SUBSCRIPTION_DEFAULTS } from "@composurecdk/sns";
```

### Subscription recommended alarms

When a dead-letter queue is attached, the builder creates the subscription-relevant [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS). Without a DLQ the alarms are skipped — the underlying metrics only emit during a redrive attempt.

| Alarm                                       | Metric                                                 | Default threshold | Created when |
| ------------------------------------------- | ------------------------------------------------------ | ----------------- | ------------ |
| `numberOfNotificationsRedrivenToDlq`        | NumberOfNotificationsRedrivenToDlq (Sum, 1 min)        | > 0               | DLQ attached |
| `numberOfNotificationsFailedToRedriveToDlq` | NumberOfNotificationsFailedToRedriveToDlq (Sum, 1 min) | > 0               | DLQ attached |

Metrics are topic-level (dimension `TopicName`); alarm constructs are scoped under the subscription's id so multiple subscriptions on the same topic do not collide.

The defaults are exported as `SUBSCRIPTION_ALARM_DEFAULTS`:

```ts
import { SUBSCRIPTION_ALARM_DEFAULTS } from "@composurecdk/sns";
```

Customization, disabling, and applying actions follow the same pattern as the topic alarms above (`recommendedAlarms({ ... })`, `recommendedAlarms(false)`, iterate the build result's `alarms`).

## Examples

- [LambdaApiStack](../examples/src/lambda-api-app.ts) — REST API with TopicBuilder for alarm actions
- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with TopicBuilder for alarm actions
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — Static website with TopicBuilder for alarm actions
