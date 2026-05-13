import { Annotations } from "aws-cdk-lib";
import { SubscriptionProtocol, type TopicSubscriptionConfig } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/**
 * Per-protocol overrides applied to a {@link TopicSubscriptionConfig}.
 *
 * Only fields relevant to delivery semantics are included; `protocol`,
 * `endpoint`, `subscriberId`, etc. are determined by the
 * {@link aws-cdk-lib.aws_sns.ITopicSubscription | ITopicSubscription} and
 * are never defaulted here.
 */
export type SubscriptionDefaults = Pick<TopicSubscriptionConfig, "rawMessageDelivery">;

/**
 * AWS-recommended defaults applied per `SubscriptionProtocol` when a
 * subscription is bound through either `createSubscriptionBuilder` or
 * `TopicBuilder.addSubscription`.
 *
 * Defaults are merged into the {@link TopicSubscriptionConfig} returned by
 * `ITopicSubscription.bind(topic)`: any field the `ITopicSubscription`
 * itself set to a defined value wins, and the default only fills the gap
 * when the bound config left the field `undefined`. This keeps every
 * default individually overridable through the `ITopicSubscription`
 * constructor options.
 *
 * Only the protocols on which SNS actually supports raw message delivery
 * (SQS and Firehose) receive a default — applying it elsewhere would
 * trigger CDK's own raw-delivery validation at synth time. Lambda is
 * intentionally absent: SNS does not support raw delivery to Lambda
 * subscriptions, and Lambda handlers always receive the SNS envelope.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html
 */
export const SUBSCRIPTION_DEFAULTS: Partial<Record<SubscriptionProtocol, SubscriptionDefaults>> = {
  /**
   * Deliver raw payloads to SQS so downstream consumers don't have to
   * unwrap the SNS envelope. Halves payload size and removes a parse step
   * — the typical choice for SNS → SQS fan-out.
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html
   */
  [SubscriptionProtocol.SQS]: { rawMessageDelivery: true },

  /**
   * Deliver raw payloads to Firehose so records are stored as the
   * publisher sent them rather than wrapped in an SNS envelope.
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html
   */
  [SubscriptionProtocol.FIREHOSE]: { rawMessageDelivery: true },
};

/**
 * Merge {@link SUBSCRIPTION_DEFAULTS} into the result of
 * `ITopicSubscription.bind(topic)` and emit transport-security warnings.
 *
 * Both `createSubscriptionBuilder` and `TopicBuilder.addSubscription`
 * route through this helper so SNS subscriptions get the same defaults
 * regardless of which builder created them.
 *
 * - Defaults are gap-filling: any field the `ITopicSubscription`
 *   explicitly set wins, and the default only applies when the bound
 *   config left the field `undefined`. Many `ITopicSubscription`
 *   implementations propagate `undefined` from their props, so a naive
 *   `{ ...defaults, ...config }` spread would clobber the defaults —
 *   this helper filters undefined entries before merging.
 * - Emits a synth-time warning when subscribing over plain `HTTP` to
 *   nudge callers toward `HTTPS` for transport encryption. Other invalid
 *   protocol/option combinations (e.g. `rawMessageDelivery` on EMAIL)
 *   are surfaced by CDK's own `Subscription` validation.
 *
 * @param scope - The construct scope used to attach annotations.
 * @param id - The subscription's logical id, used in warning text.
 * @param config - The `TopicSubscriptionConfig` returned by
 *   `ITopicSubscription.bind(topic)`.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html
 */
export function applySubscriptionDefaults(
  scope: IConstruct,
  id: string,
  config: TopicSubscriptionConfig,
): TopicSubscriptionConfig {
  const protocolDefaults = SUBSCRIPTION_DEFAULTS[config.protocol] ?? {};
  const definedConfig = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  );
  const merged = { ...protocolDefaults, ...definedConfig } as TopicSubscriptionConfig;

  if (merged.protocol === SubscriptionProtocol.HTTP) {
    Annotations.of(scope).addWarningV2(
      "@composurecdk/sns:http-subscription-insecure",
      `SNS subscription "${id}": delivering over plain HTTP — messages and any signed-confirmation tokens travel unencrypted. ` +
        `Prefer SubscriptionProtocol.HTTPS for transport encryption.`,
    );
  }

  return merged;
}
