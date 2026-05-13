import { type ITopic, type ITopicSubscription, Subscription } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  type Resolvable,
  resolve,
} from "@composurecdk/core";

/**
 * Configuration properties for the SNS subscription builder.
 *
 * Both fields are required at build time. Both accept {@link Resolvable}
 * values so the subscription can be wired to other components via
 * {@link ref} inside a {@link compose}d system.
 */
export interface SubscriptionBuilderProps {
  /**
   * The topic to subscribe to. Accepts a concrete {@link ITopic} or a
   * {@link Ref} to another component's output (e.g. a `TopicBuilder`).
   */
  topic: Resolvable<ITopic>;

  /**
   * The subscription to attach. Accepts any CDK
   * {@link ITopicSubscription} (e.g. `EmailSubscription`,
   * `LambdaSubscription`, `SqsSubscription`) or a {@link Ref} to one.
   *
   * The subscription is bound via `ITopicSubscription.bind(topic)`, which
   * performs the endpoint-specific IAM/resource-policy wire-up (Lambda
   * invoke permission, SQS queue policy, KMS decrypt grant, etc.).
   * Subscription-specific options — dead-letter queue, filter policy, raw
   * message delivery — are configured on the `ITopicSubscription` itself,
   * matching CDK's own subscription API.
   */
  subscription: Resolvable<ITopicSubscription>;
}

/**
 * The build output of an {@link ISubscriptionBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface SubscriptionBuilderResult {
  /** The SNS subscription construct created by the builder. */
  subscription: Subscription;
}

/**
 * A fluent builder for configuring and creating an AWS SNS subscription.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. Its `topic` and
 * `subscription` properties accept {@link Resolvable} values so they can be
 * supplied by another component's build output via {@link ref}.
 *
 * At build time, the configured `ITopicSubscription` is bound to the topic
 * via `ITopicSubscription.bind(topic)` — the same path CDK uses for
 * `topic.addSubscription(...)`. This ensures endpoint-specific wire-up
 * (Lambda invoke permission, SQS queue policy, etc.) happens correctly.
 *
 * Recommended CloudWatch alarms related to subscription delivery (redrive
 * to DLQ, failed redrive to DLQ) are emitted against topic-level metrics,
 * so they live on {@link createTopicBuilder} rather than here.
 *
 * Use this builder when subscribing to a *foreign* topic — one not built in
 * the same `compose` system. For the common case where a topic and its
 * subscriptions are declared together, use `TopicBuilder.addSubscription`.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Subscription.html
 *
 * @example
 * ```ts
 * import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
 *
 * const emailAlerts = createSubscriptionBuilder()
 *   .topic(ref("topic", (r: TopicBuilderResult) => r.topic))
 *   .subscription(new EmailSubscription("ops@example.com"));
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SNS::Subscription has no Tags property
export type ISubscriptionBuilder = IBuilder<SubscriptionBuilderProps, SubscriptionBuilder>;

class SubscriptionBuilder implements Lifecycle<SubscriptionBuilderResult> {
  props: Partial<SubscriptionBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): SubscriptionBuilderResult {
    const { topic, subscription } = this.props;

    if (topic === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": topic is required. Call .topic(...) with an ITopic or a Ref before building.`,
      );
    }
    if (subscription === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": subscription is required. Call .subscription(...) with an ITopicSubscription (e.g. EmailSubscription, LambdaSubscription, SqsSubscription) or a Ref before building.`,
      );
    }

    const resolvedTopic = resolve(topic, context);
    const resolvedSubscription = resolve(subscription, context);
    const subscriptionConfig = resolvedSubscription.bind(resolvedTopic);

    const built = new Subscription(scope, id, {
      topic: resolvedTopic,
      ...subscriptionConfig,
    });

    return { subscription: built };
  }
}

/**
 * Creates a new {@link ISubscriptionBuilder} for configuring an AWS SNS
 * subscription.
 *
 * The returned builder exposes `topic` and `subscription` as fluent
 * setter/getters and implements {@link Lifecycle} for use with
 * {@link compose}. Subscription-specific options (DLQ, filter policy, raw
 * message delivery) are configured on the `ITopicSubscription` itself.
 *
 * @returns A fluent builder for an AWS SNS subscription.
 *
 * @example
 * ```ts
 * import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
 *
 * const system = compose(
 *   {
 *     topic: createTopicBuilder().topicName("budget-alerts"),
 *     email: createSubscriptionBuilder()
 *       .topic(ref("topic", (r: TopicBuilderResult) => r.topic))
 *       .subscription(new EmailSubscription("ops@example.com")),
 *   },
 *   { topic: [], email: ["topic"] },
 * );
 * ```
 */
export function createSubscriptionBuilder(): ISubscriptionBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SNS::Subscription has no Tags property
  return Builder<SubscriptionBuilderProps, SubscriptionBuilder>(SubscriptionBuilder);
}
