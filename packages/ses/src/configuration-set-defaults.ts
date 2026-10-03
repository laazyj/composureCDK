import { ConfigurationSetTlsPolicy, type ConfigurationSetProps } from "aws-cdk-lib/aws-ses";

/**
 * Secure, AWS-recommended defaults applied to every configuration set built with
 * {@link createConfigurationSetBuilder} unless the caller overrides them. Each
 * property is individually overridable through the builder's fluent API, so
 * deviations are intentional and visible.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/using-configuration-sets.html
 */
export const CONFIGURATION_SET_DEFAULTS: Partial<ConfigurationSetProps> = {
  /**
   * Require TLS for every message sent with this configuration set (encrypt in
   * transit — Well-Architected Security Pillar). CloudFormation defaults this to
   * `OPTIONAL`; the AWS-recommended posture for outbound mail is to fail rather
   * than fall back to plaintext. Override with `.tlsPolicy(ConfigurationSetTlsPolicy.OPTIONAL)`
   * only if you must reach receivers that don't offer STARTTLS.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/configuration-sets-tls.html
   */
  tlsPolicy: ConfigurationSetTlsPolicy.REQUIRE,
  /**
   * Publish reputation metrics (bounce and complaint rate) for this
   * configuration set to CloudWatch, so sending health is observable per stream
   * rather than only at the account level (Well-Architected Operational
   * Excellence). CloudFormation defaults this off.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-using-event-publishing.html
   */
  reputationMetrics: true,
};
