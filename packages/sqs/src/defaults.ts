import { Duration } from "aws-cdk-lib";
import { QueueEncryption, type QueueProps } from "aws-cdk-lib/aws-sqs";

/**
 * Secure, AWS-recommended defaults applied to every SQS queue built
 * with {@link createQueueBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const QUEUE_DEFAULTS: Partial<QueueProps> = {
  /**
   * Reject any request that does not use TLS. Adds a resource policy
   * `Deny` on `aws:SecureTransport: false`, the same control applied to
   * SNS topics by {@link createTopicBuilder}.
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-security-best-practices.html
   */
  enforceSSL: true,

  /**
   * Encrypt messages at rest with the SQS-managed key (SSE-SQS). This
   * is the safe baseline; bring-your-own KMS encryption is opt-in via
   * `.encryptionMasterKey(...)` paired with `.encryption(QueueEncryption.KMS)`.
   * CDK already defaults newly-created queues to SSE-SQS — making it
   * explicit here keeps the default discoverable and stable across CDK
   * versions.
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-data-protection.html
   */
  encryption: QueueEncryption.SQS_MANAGED,

  /**
   * Enable long polling. Holds `ReceiveMessage` connections open for up
   * to 20 seconds while waiting for messages, which cuts both the cost
   * of empty receives and the perceived delivery latency of low-traffic
   * queues. The 20s value is the SQS maximum.
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html#sqs-long-polling
   */
  receiveMessageWaitTime: Duration.seconds(20),
};
