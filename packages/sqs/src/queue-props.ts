import type { QueueProps } from "aws-cdk-lib/aws-sqs";
import type { QueueAlarmConfig } from "./queue-alarm-config.js";

/**
 * A queue name for a FIFO queue. AWS requires the name of a FIFO queue to
 * end in `.fifo`, so the constraint is expressed in the type — a
 * non-conforming literal is a compile error at the call site rather than
 * a synth failure. (Unresolved tokens are not supported as FIFO queue
 * names by the CDK `Queue` construct itself.)
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html
 */
export type FifoQueueName = `${string}.fifo`;

/**
 * The {@link QueueProps} keys that only have meaning on a FIFO queue.
 * These are omitted from the standard queue builder's prop surface and
 * guarded at build time, so a queue with FIFO behaviour is always an
 * explicit choice of the FIFO-aware entry points.
 */
export const FIFO_ONLY_PROP_KEYS = [
  "fifo",
  "contentBasedDeduplication",
  "deduplicationScope",
  "fifoThroughputLimit",
] as const satisfies readonly (keyof QueueProps)[];

/** Union of the FIFO-only {@link QueueProps} keys. */
export type FifoOnlyPropKey = (typeof FIFO_ONLY_PROP_KEYS)[number];

/**
 * Builder-only props every queue builder in this package layers on top
 * of the CDK {@link QueueProps}. Defined once so the builders and the
 * shared build core agree on what must be stripped before the props
 * reach the `Queue` construct.
 */
export interface QueueBuilderExtensionProps {
  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates recommended alarms with sensible
   * thresholds for every applicable metric — which alarms apply depends
   * on the builder (primary vs. dead-letter). Individual alarms can be
   * customized or disabled. Set to `false` to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  recommendedAlarms?: QueueAlarmConfig | false;
}
