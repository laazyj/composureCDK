import type { TopicProps } from "aws-cdk-lib/aws-sns";

/**
 * Secure, AWS-recommended defaults applied to every SNS topic built
 * with {@link createTopicBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const TOPIC_DEFAULTS: Partial<TopicProps> = {
  /**
   * Enforce TLS for all publish and subscribe operations on the topic.
   * Adds a resource policy condition that denies requests not using SSL.
   * @see https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html#enforce-encryption-data-in-transit
   */
  enforceSSL: true,
};
