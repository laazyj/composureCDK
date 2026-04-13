import { type ITopic, type ITopicSubscription, Subscription } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";

/**
 * The build output of a {@link createSubscriptionBuilder} instance.
 */
export interface SubscriptionBuilderResult {
  /** The subscription construct created by the builder. */
  subscription: Subscription;
}

/**
 * A standalone builder for attaching an SNS subscription to a topic built
 * elsewhere in the system.
 *
 * Use this when the topic and the subscription live in separate components
 * — for example, the budget notification subscription wiring a Lambda
 * (built by a Lambda component) to the alerts topic (built by an SNS
 * component). For cases where the topic and its subscriptions are built
 * together, prefer {@link ITopicBuilder.addSubscription}.
 *
 * Both `topic` and `subscription` accept {@link Resolvable} so either can
 * be wired via `ref(...)` in a composed system.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     alerts: createTopicBuilder(),
 *     handler: createFunctionBuilder().runtime(...).handler(...).code(...),
 *     alertSub: createSubscriptionBuilder()
 *       .topic(ref("alerts", r => r.topic))
 *       .subscription(ref("handler", r => new LambdaSubscription(r.function))),
 *   },
 *   { alerts: [], handler: [], alertSub: ["alerts", "handler"] },
 * );
 * ```
 */
export class SubscriptionBuilder implements Lifecycle<SubscriptionBuilderResult> {
  private _topic?: Resolvable<ITopic>;
  private _subscription?: Resolvable<ITopicSubscription>;

  topic(topic: Resolvable<ITopic>): this {
    this._topic = topic;
    return this;
  }

  subscription(subscription: Resolvable<ITopicSubscription>): this {
    this._subscription = subscription;
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): SubscriptionBuilderResult {
    if (!this._topic) {
      throw new Error(`SubscriptionBuilder "${id}": topic(...) must be called before build().`);
    }
    if (!this._subscription) {
      throw new Error(
        `SubscriptionBuilder "${id}": subscription(...) must be called before build().`,
      );
    }

    const topic = resolve(this._topic, context);
    const topicSubscription = resolve(this._subscription, context);
    const subscriptionConfig = topicSubscription.bind(topic);

    const subscription = new Subscription(scope, id, {
      topic,
      ...subscriptionConfig,
    });

    return { subscription };
  }
}

/**
 * Creates a new {@link SubscriptionBuilder} for attaching a subscription to
 * an externally-built topic.
 */
export function createSubscriptionBuilder(): SubscriptionBuilder {
  return new SubscriptionBuilder();
}
