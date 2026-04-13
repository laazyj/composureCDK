import type { SubscriptionProps } from "aws-cdk-lib/aws-sns";

/**
 * Secure, AWS-recommended defaults applied to every SNS subscription built
 * with {@link createSubscriptionBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * SNS subscription defaults are deliberately minimal because the meaningful
 * defaults are protocol-specific (e.g. raw message delivery is invalid for
 * email/SMS but often desirable for SQS/Lambda). Reliability is best
 * improved by attaching a dead-letter queue via {@link SubscriptionBuilderProps.deadLetterQueue};
 * doing so requires materialising a queue resource the caller owns, which
 * cannot be inferred.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
 * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html
 */
export const SUBSCRIPTION_DEFAULTS: Partial<SubscriptionProps> = {
  /**
   * Raw message delivery is opt-in. It is only valid for HTTP/S, SQS,
   * Lambda, and Firehose subscriptions and must be chosen deliberately per
   * subscription. Pinning it to `false` here makes the default explicit and
   * ensures user overrides show up as intentional changes.
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html
   */
  rawMessageDelivery: false,
};
