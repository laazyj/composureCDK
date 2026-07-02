import { Annotations, Token } from "aws-cdk-lib";
import { DeduplicationScope, FifoThroughputLimit } from "aws-cdk-lib/aws-sqs";
import type { DeadLetterQueue, QueueProps } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import { FIFO_ONLY_PROP_KEYS } from "./queue-props.js";

/**
 * AWS-recommended minimum for `maxReceiveCount` on an SQS redrive
 * policy. A consumer needs a few retries before SQS gives up and
 * forwards the message to the dead-letter queue; anything below this
 * tends to surface as a flood of "poison" messages from transient
 * errors that would have succeeded on retry.
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
 */
const RECOMMENDED_MIN_MAX_RECEIVE_COUNT = 5;

/**
 * Annotates `scope` with a non-fatal warning when a redrive policy is
 * configured with `maxReceiveCount` below the AWS-recommended floor
 * of {@link RECOMMENDED_MIN_MAX_RECEIVE_COUNT}.
 *
 * The builder owns the redrive policy directly, so this is a true
 * check rather than a contextual reminder — the actual configured
 * value is compared. Short-circuits on unresolved tokens so stacks
 * that thread `maxReceiveCount` through CFN parameters aren't spammed.
 */
export function warnIfLowMaxReceiveCount(
  scope: IConstruct,
  builderName: string,
  id: string,
  props: Partial<QueueProps>,
): void {
  const dlq = props.deadLetterQueue;
  if (!dlq) return;
  const maxReceiveCount = dlq.maxReceiveCount;
  if (Token.isUnresolved(maxReceiveCount)) return;
  if (maxReceiveCount >= RECOMMENDED_MIN_MAX_RECEIVE_COUNT) return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/sqs:redrive-low-max-receive-count",
    `${builderName} "${id}": redrive policy maxReceiveCount is ${String(maxReceiveCount)}; ` +
      `AWS recommends >= ${String(RECOMMENDED_MIN_MAX_RECEIVE_COUNT)} so the consumer ` +
      `has room to retry before messages hit the dead-letter queue. ` +
      `See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html`,
  );
}

/**
 * Throws when a FIFO-only prop reaches the standard queue builder — the
 * standard builder's typed surface omits them, so this catches untyped
 * (JavaScript) callers and points them at the FIFO-aware entry points
 * instead of letting the queue synth with primary-queue alarm defaults
 * that don't fit a FIFO queue.
 */
export function throwIfFifoPropsOnStandardQueue(id: string, props: Partial<QueueProps>): void {
  for (const key of FIFO_ONLY_PROP_KEYS) {
    if (props[key] === undefined) continue;
    throw new Error(
      `QueueBuilder "${id}": "${key}" is FIFO-specific and not supported by ` +
        `createQueueBuilder(). Use createFifoQueueBuilder() for a FIFO queue, or ` +
        `createDlqQueueBuilder().fifo(true) for a FIFO dead-letter queue.`,
    );
  }
}

/**
 * Validates the FIFO-specific configuration invariants that would
 * otherwise surface as a synth or deploy failure:
 *
 * - A non-token `queueName` must end in `.fifo` (AWS requirement).
 * - High-throughput mode (`fifoThroughputLimit: PER_MESSAGE_GROUP_ID`)
 *   requires `deduplicationScope: MESSAGE_GROUP`.
 *
 * No-op unless `props.fifo` is set, so builders whose FIFO-ness is a
 * prop (the DLQ builder) can call it unconditionally — the validator
 * owns both the invariants and their applicability.
 *
 * These are configuration errors, not advisory best practice, so they
 * throw (unlike the `maxReceiveCount` warning).
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html
 */
export function validateFifoQueueProps(
  builderName: string,
  id: string,
  props: Partial<QueueProps>,
): void {
  const { fifo, queueName, fifoThroughputLimit, deduplicationScope } = props;
  if (!fifo) return;

  if (queueName !== undefined && !Token.isUnresolved(queueName) && !queueName.endsWith(".fifo")) {
    throw new Error(
      `${builderName} "${id}": FIFO queues require a queueName ending in ".fifo"; ` +
        `got "${queueName}". Omit queueName to let CloudFormation generate one.`,
    );
  }

  if (
    fifoThroughputLimit === FifoThroughputLimit.PER_MESSAGE_GROUP_ID &&
    deduplicationScope !== DeduplicationScope.MESSAGE_GROUP
  ) {
    throw new Error(
      `${builderName} "${id}": fifoThroughputLimit=PER_MESSAGE_GROUP_ID (high-throughput ` +
        `FIFO) requires deduplicationScope=MESSAGE_GROUP. ` +
        `See https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html`,
    );
  }
}

/**
 * Throws when a queue's redrive target does not match its own FIFO-ness.
 * AWS requires the dead-letter queue of a FIFO queue to be FIFO and the
 * dead-letter queue of a standard queue to be standard; the mismatch
 * otherwise fails at deploy time, after a successful synth.
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
 */
export function throwIfRedriveTargetFifoMismatch(
  builderName: string,
  id: string,
  fifo: boolean,
  deadLetterQueue: DeadLetterQueue | undefined,
): void {
  if (!deadLetterQueue) return;
  if (deadLetterQueue.queue.fifo === fifo) return;
  const [queueKind, targetKind] = fifo ? ["FIFO", "standard"] : ["standard", "FIFO"];
  throw new Error(
    `${builderName} "${id}": a ${queueKind} queue cannot redrive to the ${targetKind} ` +
      `dead-letter queue "${deadLetterQueue.queue.node.id}" — AWS requires the ` +
      `dead-letter queue to match the source queue's type. ` +
      `See https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html`,
  );
}

/**
 * Throws when a dead-letter queue is given its own `deadLetterQueue`
 * redrive policy — a DLQ is the terminal destination for failed
 * messages; a queue that redrives elsewhere is a primary queue and
 * belongs to `createQueueBuilder()` / `createFifoQueueBuilder()`.
 */
export function throwIfRedriveOnDlq(id: string, props: Partial<QueueProps>): void {
  if (!props.deadLetterQueue) return;
  throw new Error(
    `DlqQueueBuilder "${id}": deadLetterQueue is not supported on a dead-letter queue — ` +
      `a DLQ is the terminal destination for failed messages. If this queue needs its ` +
      `own redrive policy it is a primary queue: use createQueueBuilder() or ` +
      `createFifoQueueBuilder() instead.`,
  );
}
