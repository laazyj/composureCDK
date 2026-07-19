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
   * on the queue's role (primary vs. dead-letter). Individual alarms can
   * be customized or disabled. Set to `false` to disable the recommended
   * alarms; custom alarms added via `addAlarm()` are still created.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#SQS
   */
  recommendedAlarms?: QueueAlarmConfig | false;
}

/**
 * Prop surface of `createQueueBuilder()` / `createQueueBuilder("standard")`:
 * every CDK {@link QueueProps} property except the FIFO-only ones — a
 * queue with FIFO behaviour is an explicit role choice
 * (`createQueueBuilder("fifo")`), not a prop.
 */
export interface QueueBuilderProps
  extends Omit<QueueProps, FifoOnlyPropKey>, QueueBuilderExtensionProps {}

/**
 * Prop surface of `createQueueBuilder("fifo")`. `fifo` itself is not
 * settable — the role is the switch — and `queueName` is typed as
 * {@link FifoQueueName}, so a name missing the AWS-required `.fifo`
 * suffix is a compile error rather than a synth failure.
 */
export interface FifoQueueBuilderProps
  extends Omit<QueueProps, "fifo" | "queueName">, QueueBuilderExtensionProps {
  /**
   * Physical name of the FIFO queue. Must end in `.fifo` (AWS
   * requirement, enforced by the type and validated at build for
   * untyped callers). Omit to let CloudFormation generate a valid name.
   */
  queueName?: FifoQueueName;
}

/**
 * Prop surface of `createQueueBuilder("dlq")`: the standard surface (no
 * FIFO-only props — a FIFO dead-letter queue is its own role,
 * `"fifo-dlq"`) minus `deadLetterQueue`, because a dead-letter queue is
 * the terminal destination for failed messages and must not carry its
 * own redrive policy.
 */
export type DlqQueueBuilderProps = Omit<QueueBuilderProps, "deadLetterQueue">;

/**
 * Prop surface of `createQueueBuilder("fifo-dlq")`: the FIFO surface
 * (suffix-typed `queueName`, no settable `fifo`) minus
 * `deadLetterQueue`, for the dead-letter queue of a FIFO source — AWS
 * requires it to itself be FIFO.
 */
export type FifoDlqQueueBuilderProps = Omit<FifoQueueBuilderProps, "deadLetterQueue">;

/**
 * Maps each {@link QueueRole} to its prop surface. `createQueueBuilder`
 * uses this to give every role an exact fluent API — props that don't
 * apply to a role simply don't exist on its builder type.
 */
export interface QueueBuilderPropsByRole {
  standard: QueueBuilderProps;
  fifo: FifoQueueBuilderProps;
  dlq: DlqQueueBuilderProps;
  "fifo-dlq": FifoDlqQueueBuilderProps;
}
