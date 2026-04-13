import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { type ITopic, Subscription, type SubscriptionProps } from "aws-cdk-lib/aws-sns";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  type Resolvable,
  resolve,
} from "@composurecdk/core";
import type { SubscriptionAlarmConfig } from "./subscription-alarm-config.js";
import { createSubscriptionAlarms } from "./subscription-alarms.js";
import { SUBSCRIPTION_DEFAULTS } from "./subscription-defaults.js";

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
   * subscriptions and also enables the recommended redrive alarms.
   *
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
   * @default - no dead letter queue
   */
  deadLetterQueue?: Resolvable<IQueue>;

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds whenever a {@link deadLetterQueue} is attached. Individual
   * alarms can be customized or disabled. Set to `false` to disable all
   * alarms.
   *
   * No alarm actions are configured by default since notification methods
   * are user-specific. Access alarms from the build result or use an
   * `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  recommendedAlarms?: SubscriptionAlarmConfig | false;
}

/**
 * The build output of an {@link ISubscriptionBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface SubscriptionBuilderResult {
  /** The SNS subscription construct created by the builder. */
  subscription: Subscription;

  /**
   * CloudWatch alarms created for the subscription, keyed by alarm name.
   *
   * Only populated when a {@link SubscriptionBuilderProps.deadLetterQueue}
   * is attached; otherwise this is an empty record.
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SNS
   */
  alarms: Record<string, Alarm>;
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
 * When built, it creates an SNS subscription with the configured properties
 * and returns a {@link SubscriptionBuilderResult}. Recommended CloudWatch
 * alarms are created when a dead-letter queue is attached.
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
export type ISubscriptionBuilder = IBuilder<SubscriptionBuilderProps, SubscriptionBuilder>;

class SubscriptionBuilder implements Lifecycle<SubscriptionBuilderResult> {
  props: Partial<SubscriptionBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): SubscriptionBuilderResult {
    const {
      recommendedAlarms: alarmConfig,
      topic,
      deadLetterQueue,
      ...subscriptionProps
    } = this.props;

    if (topic === undefined) {
      throw new Error(
        `SubscriptionBuilder "${id}": topic is required. Call .topic(...) with an ITopic or a Ref before building.`,
      );
    }

    const resolvedTopic = resolve(topic, context);
    const resolvedDlq =
      deadLetterQueue !== undefined ? resolve(deadLetterQueue, context) : undefined;

    const mergedProps = {
      ...SUBSCRIPTION_DEFAULTS,
      ...subscriptionProps,
      topic: resolvedTopic,
      ...(resolvedDlq !== undefined ? { deadLetterQueue: resolvedDlq } : {}),
    } as SubscriptionProps;

    const subscription = new Subscription(scope, id, mergedProps);

    const alarms = createSubscriptionAlarms(scope, id, resolvedTopic, resolvedDlq, alarmConfig);

    return { subscription, alarms };
  }
}

/**
 * Creates a new {@link ISubscriptionBuilder} for configuring an AWS SNS
 * subscription.
 *
 * This is the entry point for defining an SNS subscription component. The
 * returned builder exposes every {@link SubscriptionBuilderProps} property
 * as a fluent setter/getter and implements {@link Lifecycle} for use with
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
  return Builder<SubscriptionBuilderProps, SubscriptionBuilder>(SubscriptionBuilder);
}
