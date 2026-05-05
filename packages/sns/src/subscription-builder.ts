import { type ITopic, Subscription, type SubscriptionProps } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import { type Lifecycle, type Resolvable, resolve } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";

/**
 * Configuration properties for the SNS subscription builder.
 *
 * Extends the CDK {@link SubscriptionProps} but accepts {@link Resolvable}
 * values for `topic` and `deadLetterQueue` so the builder can be wired to
 * other components via {@link ref} inside a {@link compose}d system.
 */
export interface SubscriptionBuilderProps extends Omit<
  SubscriptionProps,
  "topic" | "deadLetterQueue"
> {
  /**
   * The topic to subscribe to. Accepts a concrete {@link ITopic} or a
   * {@link Ref} to another component's output (e.g. a `TopicBuilder`).
   */
  topic: Resolvable<ITopic>;

  /**
   * Dead-letter queue for messages that cannot be delivered to the
   * subscribed endpoint. Accepts a concrete {@link IQueue} or a
   * {@link Ref} to another component's output.
   *
   * Attaching a DLQ is the primary reliability control for SNS
   * subscriptions. Redrive and redrive-failure alarms are created on the
   * subscribed {@link TopicBuilder} since the underlying metrics are
   * topic-level.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
   * @default - no dead letter queue
   */
  deadLetterQueue?: Resolvable<IQueue>;
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
 * Each configuration property from the CDK {@link SubscriptionProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current
 * value.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. Its `topic` and
 * `deadLetterQueue` properties accept {@link Resolvable} values so they can
 * be supplied by another component's build output via {@link ref}.
 *
 * Recommended CloudWatch alarms related to subscription delivery (redrive
 * to DLQ, failed redrive to DLQ) are emitted against topic-level metrics,
 * so they live on {@link createTopicBuilder} rather than here.
 *
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Subscription.html
 *
 * @example
 * ```ts
 * const emailAlerts = createSubscriptionBuilder()
 *   .topic(ref("topic", (r: TopicBuilderResult) => r.topic))
 *   .protocol(SubscriptionProtocol.EMAIL)
 *   .endpoint("ops@example.com");
 * ```
 */
export type ISubscriptionBuilder = ITaggedBuilder<SubscriptionBuilderProps, SubscriptionBuilder>;

class SubscriptionBuilder implements Lifecycle<SubscriptionBuilderResult> {
  props: Partial<SubscriptionBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): SubscriptionBuilderResult {
    const { topic, deadLetterQueue, protocol, endpoint, ...rest } = this.props;

    if (topic === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": topic is required. Call .topic(...) with an ITopic or a Ref before building.`,
      );
    }
    if (protocol === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": protocol is required. Call .protocol(...) with a SubscriptionProtocol before building.`,
      );
    }
    if (endpoint === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": endpoint is required. Call .endpoint(...) with the subscriber endpoint before building.`,
      );
    }

    const resolvedTopic = resolve(topic, context);
    const resolvedDlq =
      deadLetterQueue !== undefined ? resolve(deadLetterQueue, context) : undefined;

    const subscriptionProps: SubscriptionProps = {
      ...rest,
      protocol,
      endpoint,
      topic: resolvedTopic,
      ...(resolvedDlq !== undefined ? { deadLetterQueue: resolvedDlq } : {}),
    };

    const subscription = new Subscription(scope, id, subscriptionProps);

    return { subscription };
  }
}

/**
 * Creates a new {@link ISubscriptionBuilder} for configuring an AWS SNS
 * subscription.
 *
 * This is the entry point for defining an SNS subscription component. The
 * returned builder exposes every {@link SubscriptionProps} property as a
 * fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @returns A fluent builder for an AWS SNS subscription.
 *
 * @example
 * ```ts
 * const system = compose(
 *   {
 *     topic: createTopicBuilder().topicName("budget-alerts"),
 *     email: createSubscriptionBuilder()
 *       .topic(ref("topic", (r: TopicBuilderResult) => r.topic))
 *       .protocol(SubscriptionProtocol.EMAIL)
 *       .endpoint("ops@example.com"),
 *   },
 *   { topic: [], email: ["topic"] },
 * );
 * ```
 */
export function createSubscriptionBuilder(): ISubscriptionBuilder {
  return taggedBuilder<SubscriptionBuilderProps, SubscriptionBuilder>(SubscriptionBuilder);
}
