import {
  MailFromBehaviorOnMxFailure,
  type ReceiptRuleOptions,
  TlsPolicy,
} from "aws-cdk-lib/aws-ses";

/**
 * Secure, AWS-recommended defaults applied to every receipt rule unless the
 * caller overrides them. Each property is individually overridable through the
 * rule sub-builder's fluent API, so deviations are intentional and visible.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/security-protocols.html
 */
export const DEFAULT_RECEIPT_RULE: Partial<ReceiptRuleOptions> = {
  /**
   * Scan inbound mail for spam and viruses. CloudFormation defaults this to
   * off; the AWS-recommended posture for a mail-receiving endpoint is on.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html
   */
  scanEnabled: true,
  /**
   * Reject mail not delivered over TLS (encrypt in transit — Well-Architected
   * Security Pillar). ~95%+ of legitimate inbound mail already uses TLS, and a
   * non-TLS sender receives a hard bounce (fail-loud, not a silent drop), so a
   * rejected message is surfaced to its sender rather than lost. Override with
   * `.tlsPolicy(TlsPolicy.OPTIONAL)` on a rule that must accept mail from legacy
   * senders that don't offer STARTTLS.
   *
   * @see https://docs.aws.amazon.com/ses/latest/dg/security-protocols.html
   */
  tlsPolicy: TlsPolicy.REQUIRE,
};

/**
 * MAIL FROM behaviour applied when a custom MAIL FROM domain is configured but
 * no behaviour is set: reject the message on MX-record failure rather than fall
 * back to the shared `amazonses.com` domain. The fallback breaks SPF/DMARC
 * alignment, so rejecting is the secure default.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/mail-from.html
 */
export const DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE = MailFromBehaviorOnMxFailure.REJECT_MESSAGE;
