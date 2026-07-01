import { Duration } from "aws-cdk-lib";
import type { QueueProps } from "aws-cdk-lib/aws-sqs";

/**
 * AWS-recommended defaults layered on top of {@link QUEUE_DEFAULTS} when a
 * queue is built in the dead-letter-queue role via
 * `createQueueBuilder().asDeadLetterQueue()`.
 */
export const DLQ_QUEUE_DEFAULTS: Partial<QueueProps> = {
  /**
   * 14 days — the SQS maximum. A dead-letter queue exists to give
   * operators a window to investigate and redrive failed messages, so
   * maximizing that window is the point; a primary queue's 4-day CDK
   * default would let messages expire before anyone notices them.
   * @see https://docs.aws.amazon.com/AmazonSQS/latest/SQSDeveloperGuide/sqs-basic-architecture.html
   */
  retentionPeriod: Duration.days(14),
};
