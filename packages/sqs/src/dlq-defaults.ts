import { Duration } from "aws-cdk-lib";
import type { QueueProps } from "aws-cdk-lib/aws-sqs";

/**
 * AWS-recommended defaults layered on top of {@link QUEUE_DEFAULTS} for
 * queues built in a dead-letter role (`createQueueBuilder("dlq")` /
 * `createQueueBuilder("fifo-dlq")`).
 */
export const DLQ_QUEUE_DEFAULTS = {
  /**
   * 14 days — the SQS maximum. A dead-letter queue exists to give
   * operators a window to investigate and redrive failed messages, so
   * maximizing that window is the point; the 4-day CDK default would let
   * messages expire before anyone notices them. The Well-Architected
   * Reliability Pillar calls for retaining failed messages long enough
   * to analyse and reprocess them.
   * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
   */
  retentionPeriod: Duration.days(14),
} satisfies Partial<QueueProps>;
