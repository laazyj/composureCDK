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

### Encryption at rest

SNS has no service-managed encryption option — a topic is unencrypted at rest until a KMS key is supplied. `.masterKey(...)` accepts a concrete `IKey` or a `Resolvable`, so a key built by [`@composurecdk/kms`](../kms/README.md) can be a component of the same system:

```ts
compose(
  {
    topicKey: createKeyBuilder().description("Encrypts the alerts topic at rest."),
    alerts: createTopicBuilder().masterKey(ref<KeyBuilderResult>("topicKey").get("key")),
  },
  { topicKey: [], alerts: ["topicKey"] },
);
```

The defaults are exported as `TOPIC_DEFAULTS` for visibility and testing:

```ts
import { TOPIC_DEFAULTS } from "@composurecdk/sns";
```

### Overriding defaults

```ts
const topic = createTopicBuilder().topicName("my-topic").enforceSSL(false).build(stack, "MyTopic");
```

## Topic Access Policy

A topic has one access policy. CDK creates it as an `AWS::SNS::TopicPolicy` the first time a statement is added — by the `enforceSSL` default, by `allowServicePublish`, or by `addToResourcePolicy` — and every later statement joins that same policy. The build result returns it as `result.policy`, which CDK keeps private on `Topic`; it is `undefined` when the topic had no statements at build time.

Use `allowServicePublish` to let an AWS service publish to the topic. The statement joins the topic's own policy, next to the `enforceSSL` statement:

```ts
createTopicBuilder()
  .allowServicePublish("codestar-notifications.amazonaws.com", {
    conditions: { StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID } },
  })
  .build(stack, "Alerts");
```

`conditions` is optional; use one where the service supports it, to guard against the [confused deputy problem](https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html). Integrations that wire themselves — EventBridge targets, S3 notifications, and [`@composurecdk/budgets`](../budgets/README.md) SNS subscribers — already add their statement to the topic's policy, so they need no `allowServicePublish`.

For any other statement, use `addToResourcePolicy`. Pass a function of the topic to name its ARN, which an SNS statement needs as its `Resource`:

```ts
import { AccountPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";

createTopicBuilder().addToResourcePolicy(
  (topic) =>
    new PolicyStatement({
      principals: [new AccountPrincipal("111122223333")],
      actions: ["sns:Publish"],
      resources: [topic.topicArn],
    }),
);
```

- **Use it for what an in-app grant cannot express:** access from another account, and guardrails such as an organisation (`aws:PrincipalOrgID`) or VPC endpoint (`aws:SourceVpce`) condition. Grant an IAM principal in the app access on the principal's side with `topicGrants` instead ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)).
- **The statement, or the function's return value, may be a `ref` or `combine`**, so it can name a sibling the policy depends on, such as a VPC endpoint. A component that depends on the topic cannot be named that way: `compose` rejects the cycle.

Do not create another `TopicPolicy` for a topic built here: each policy resource replaces the topic's policy outright, so one of them is lost. Add to the topic's own policy with `addToResourcePolicy` instead. [`topicPolicyConflictPolicy`](#topic-policy-conflict-policy) catches this at synth.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm                                               | Metric                                                          | Default threshold | Created when                                |
| --------------------------------------------------- | --------------------------------------------------------------- | ----------------- | ------------------------------------------- |
| `numberOfNotificationsFailed`                       | NumberOfNotificationsFailed (Sum, 1 min)                        | > 0               | Always                                      |
| `numberOfNotificationsFilteredOutInvalidAttributes` | NumberOfNotificationsFilteredOut-InvalidAttributes (Sum, 1 min) | > 0               | A subscription has a filter policy[^filter] |
| `numberOfNotificationsRedrivenToDlq`                | NumberOfNotificationsRedrivenToDlq (Sum, 1 min)                 | > 0               | A subscription has a DLQ[^dlq]              |
| `numberOfNotificationsFailedToRedriveToDlq`         | NumberOfNotificationsFailedToRedriveToDlq (Sum, 1 min)          | > 0               | A subscription has a DLQ[^dlq]              |

[^filter]: The metric only emits data when a subscription on the topic has a filter policy, so the builder creates the alarm only when a subscription added via `addSubscription()` has a `filterPolicy` or `filterPolicyWithMessageBody`. As with the redrive alarms, a subscription made with `createSubscriptionBuilder` is not seen: pass an explicit config (`{}` for the defaults) to create the alarm regardless.

[^dlq]: The redrive metrics only emit data when a subscription on the topic has a dead-letter queue attached and SNS attempts redrive, so the builder creates these two alarms only when a subscription added via `addSubscription()` has one. A DLQ on a subscription made with `createSubscriptionBuilder` is not seen, so a topic whose DLQ subscriptions are all built that way gets neither alarm unless you ask: pass an explicit config (`{}` for the defaults) to create either alarm regardless. Attach a DLQ on the `ITopicSubscription` itself (e.g. `new LambdaSubscription(fn, { deadLetterQueue: dlq })`) — see [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html).

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

### Reading alarms by key

`TopicBuilderResult` types `alarms` by key, so a misspelled key is a compile error rather than `undefined` at synth. A recommended alarm is `Alarm | undefined`, because it can be disabled, or not apply to the topic's subscriptions. To read a custom alarm, name its key with `WithCustomAlarms`, from `@composurecdk/cloudwatch`, and it is typed `Alarm`:

```ts
ref("events", (r: TopicBuilderResult) => r.alarms.numberOfNotificationsFailed); // Alarm | undefined
ref(
  "events",
  (r: WithCustomAlarms<TopicBuilderResult, "highPublishRate">) => r.alarms.highPublishRate,
); // Alarm
ref("events", (r: TopicBuilderResult) => r.alarms.numberOfNotificationFailed); // compile error
```

The custom keys you name are not checked against the builder's `addAlarm` calls. The result of the builder's own `build()` accepts any key, as `WithCustomAlarms<TopicBuilderResult, string>`. The recommended keys are exported as `TopicAlarmKey`.

### Applying alarm actions

Alarms are returned in the build result's `alarms`, keyed by alarm:

```ts
const result = topic.build(stack, "MyTopic");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

### Alert topics

`numberOfNotificationsFailed` and the two redrive alarms report that SNS is failing to deliver the topic's messages. Don't send one to the topic it watches: its notification goes down the same failing path, so only subscriptions that are still delivering receive it, and on a single-subscriber topic none do. This is easy to do by accident with an alert topic, because a stack-wide [`alarmActionsPolicy`](../cloudwatch/README.md) also reaches the topic's own alarms.

The builder warns at synth time (`TOPIC_ALARM_SELF_NOTIFICATION_WARNING_ID`) when an alarm on one of those metrics, recommended or added with `addAlarm`, lists its own topic in its actions. Fix it in one of two ways:

- **Route the topic's alarms somewhere else**, such as a second topic with a different channel. With a stack-wide policy, add a rule that matches the alert topic's alarms with `replaceDefaults: true` and that topic's action. CloudWatch alarm actions must target a topic in the same region as the alarm.
- **Turn the alarms off on the alert topic** with `recommendedAlarms(false)` when there is nowhere else to send them. An alert topic whose subscriber is a person's inbox gains nothing from alarms it cannot deliver.

```ts
const alerts = createTopicBuilder()
  .displayName("Site alerts")
  .addSubscription("email", new EmailSubscription("ops@example.com"))
  .recommendedAlarms(false);
```

## Adding Subscriptions to a Topic

For the common case where a topic and its subscriptions are declared together, use `addSubscription` on the topic builder. It accepts any CDK [`ITopicSubscription`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.ITopicSubscription.html) (e.g. `EmailSubscription`, `LambdaSubscription`, `SqsSubscription`) and binds it via `ITopicSubscription.bind(topic)` — the same path CDK uses for `topic.addSubscription(...)`, so endpoint-specific wire-up (Lambda invoke permission, SQS queue policy, KMS decrypt policy) happens automatically. Each subscription's construct ID is `${id}${Capitalize(key)}Subscription`, with `key` sanitised by `sanitizeConstructId` from `@composurecdk/core`.

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

Attaching a dead-letter queue is the primary reliability control for SNS subscriptions ([AWS Well-Architected — Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html), [SNS DLQ docs](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)). Pass a queue to the `ITopicSubscription` constructor (e.g. `new EmailSubscription("ops@example.com", { deadLetterQueue: dlq })`).

**Neither builder creates a DLQ for you.** A dead-letter queue is a separate, billable queue that needs an owner — a DLQ nobody drains is just a slower way to lose messages — so it is declared as a sibling and referenced, which also gets it ComposureCDK's dead-letter defaults (14-day retention) and depth alarm:

```ts
const system = compose(
  {
    orders: createQueueBuilder(),
    ordersDlq: createQueueBuilder("dlq"),

    orderEvents: createTopicBuilder().addSubscription(
      "orders",
      combine(
        { orders: ref<QueueBuilderResult>("orders"), dlq: ref<QueueBuilderResult>("ordersDlq") },
        ({ orders, dlq }) => new SqsSubscription(orders.queue, { deadLetterQueue: dlq.queue }),
      ),
    ),
  },
  { orders: [], ordersDlq: [], orderEvents: ["orders", "ordersDlq"] },
);
```

CDK's `Subscription` construct adds the queue policy that lets `sns.amazonaws.com` write to the DLQ (scoped to the topic ARN), so no extra grant is needed.

If the DLQ is encrypted with a customer-managed KMS key (`createQueueBuilder("dlq").encryptionMasterKey(key)`), SNS also needs `kms:Decrypt` and `kms:GenerateDataKey` on that key, which CDK does not grant. Without them the deploy succeeds but every redrive fails. Both builders add that statement to the key policy, scoped by `aws:SourceArn` to the topic. The DLQ default, SSE-SQS, needs no key grant. An imported key's policy can't be changed from the app, so the builders emit a `@composurecdk/sns:subscription-dlq-key-not-granted` warning (`SUBSCRIPTION_DLQ_KEY_WARNING_ID`) instead. Make the grant where the key is owned, then acknowledge the warning.

The CloudWatch metrics that surface delivery failures (`NumberOfNotificationsRedrivenToDlq`, `NumberOfNotificationsFailedToRedriveToDlq`) are topic-level, so the recommended alarms for them live on the `TopicBuilder` (see [Recommended Alarms](#recommended-alarms) above). It creates them when a subscription added via `addSubscription()` has a DLQ; see the footnote there for a DLQ on a subscription made with `createSubscriptionBuilder`. Pair them with the DLQ's own depth alarm — that pair is what turns an undelivered notification into a page.

[`ComposureCDK-OrderProcessorStack`](../examples/src/order-processor-app.ts) deploys this shape end to end and its [smoke test](../examples/test/smoke/order-processor.smoke.mjs) proves the delivery path against live AWS.

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

## Topic Policy Conflict Policy

An SNS topic has exactly one access policy. Every `AWS::SNS::TopicPolicy` and `AWS::SNS::TopicInlinePolicy` replaces it outright, so when two target the same topic, whichever CloudFormation applies last wins and the other's statements disappear. CloudFormation gives no error or warning, and the order can change between deployments.

`topicPolicyConflictPolicy` catches this at synth. It installs a CDK Aspect over a scope and fails synth when a second policy resource targets a topic that already has one:

```ts
import { topicPolicyConflictPolicy } from "@composurecdk/sns";

topicPolicyConflictPolicy(app); // or { onViolation: "warn" } to annotate instead
```

The usual cause is a `new TopicPolicy(...)` for a topic built in CDK, alongside the policy CDK creates for the topic itself (for example, for the `enforceSSL` default). Add to the topic's own policy with the builder's `addToResourcePolicy`, or `topic.addToResourcePolicy(...)` for a topic built elsewhere, instead.

The check matches topics by the resolved `Topics`/`TopicArn` value: a literal ARN matches across stacks, and a `Ref` matches within its stack.

## Examples

- [OrderProcessorStack](../examples/src/order-processor-app.ts) — SNS → SQS fan-out with a dead-letter queue on the subscription
- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with TopicBuilder for alarm actions
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — Static website with TopicBuilder for alarm actions
