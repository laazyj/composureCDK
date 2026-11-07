import { Annotations } from "aws-cdk-lib";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { ITopic, TopicSubscriptionConfig } from "aws-cdk-lib/aws-sns";
import type { IConstruct } from "constructs";

/**
 * Warning emitted when a subscription's dead-letter queue is encrypted
 * with a KMS key whose policy cannot be changed from this app (an
 * imported key), so SNS cannot be granted the access it needs to write
 * to the DLQ. Acknowledge it with
 * `Annotations.of(scope).acknowledgeWarning(SUBSCRIPTION_DLQ_KEY_WARNING_ID)`
 * once the key policy has been updated where the key is owned.
 */
export const SUBSCRIPTION_DLQ_KEY_WARNING_ID = "@composurecdk/sns:subscription-dlq-key-not-granted";

/**
 * Lets SNS use the KMS key that encrypts a subscription's dead-letter
 * queue.
 *
 * CDK's `Subscription` construct adds the `sqs:SendMessage` queue-policy
 * statement for the DLQ, but not the matching KMS grant — unlike
 * `SqsSubscription.bind`, which grants the endpoint queue's key. Without
 * it, SNS's redrive to a DLQ encrypted with a customer-managed key fails
 * at runtime, after a clean deploy; the only signal is the topic's
 * `NumberOfNotificationsFailedToRedriveToDlq` metric. The statement
 * mirrors the one CDK adds for the endpoint queue, scoped to the topic
 * with `aws:SourceArn`.
 *
 * No-op when the subscription has no DLQ or the DLQ uses SSE-SQS (no
 * key). When the key is imported, its policy can't be changed here, so a
 * warning ({@link SUBSCRIPTION_DLQ_KEY_WARNING_ID}) says what to grant.
 *
 * @see https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html
 */
export function grantSubscriptionDlqKey(
  scope: IConstruct,
  id: string,
  topic: ITopic,
  config: TopicSubscriptionConfig,
): void {
  const key = config.deadLetterQueue?.encryptionMasterKey;
  if (key === undefined) return;

  const { statementAdded } = key.addToResourcePolicy(
    new PolicyStatement({
      principals: [new ServicePrincipal("sns.amazonaws.com")],
      actions: ["kms:Decrypt", "kms:GenerateDataKey"],
      resources: ["*"],
      conditions: { ArnEquals: { "aws:SourceArn": topic.topicArn } },
    }),
  );
  if (statementAdded) return;

  Annotations.of(scope).addWarningV2(
    SUBSCRIPTION_DLQ_KEY_WARNING_ID,
    `SNS subscription "${id}": the dead-letter queue is encrypted with an imported KMS key, ` +
      `so its key policy can't be updated here. Grant sns.amazonaws.com kms:Decrypt and ` +
      `kms:GenerateDataKey on the key (scoped by aws:SourceArn to the topic), or SNS will ` +
      `fail to redrive undeliverable messages to the dead-letter queue.`,
  );
}
