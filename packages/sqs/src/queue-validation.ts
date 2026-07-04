import { Annotations, Token } from "aws-cdk-lib";
import { DeduplicationScope, FifoThroughputLimit } from "aws-cdk-lib/aws-sqs";
import type { DeadLetterQueue, QueueProps } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import { FIFO_ONLY_PROP_KEYS } from "./queue-props.js";
import { isDlqRole, isFifoRole, type QueueRole } from "./queue-role.js";

/**
 * Runs every build-time check for a queue in the given role against its
 * merged props. This is the single validation entry point — each guard
 * owns its own applicability (self-gating on the role or on the props),
 * so a new role or a new invariant is entirely a change to this module,
 * never new branching in the builder.
 */
export function validateQueueProps(
  scope: IConstruct,
  id: string,
  role: QueueRole,
  props: Partial<QueueProps>,
): void {
  if (!isFifoRole(role)) throwIfFifoPropsOnNonFifoRole(id, role, props);
  validateFifoQueueProps(id, props);
  if (isDlqRole(role)) {
    throwIfRedriveOnDlqRole(id, role, props);
  } else {
    throwIfRedriveTargetFifoMismatch(id, isFifoRole(role), props.deadLetterQueue);
    warnIfLowMaxReceiveCount(scope, id, props);
  }
}

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
function warnIfLowMaxReceiveCount(scope: IConstruct, id: string, props: Partial<QueueProps>): void {
  const dlq = props.deadLetterQueue;
  if (!dlq) return;
  const maxReceiveCount = dlq.maxReceiveCount;
  if (Token.isUnresolved(maxReceiveCount)) return;
  if (maxReceiveCount >= RECOMMENDED_MIN_MAX_RECEIVE_COUNT) return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/sqs:redrive-low-max-receive-count",
    `QueueBuilder "${id}": redrive policy maxReceiveCount is ${String(maxReceiveCount)}; ` +
      `AWS recommends >= ${String(RECOMMENDED_MIN_MAX_RECEIVE_COUNT)} so the consumer ` +
      `has room to retry before messages hit the dead-letter queue. ` +
      `See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html`,
  );
}

/**
 * Throws when a FIFO-only prop reaches a non-FIFO role — the role's
 * typed surface omits them, so this catches untyped (JavaScript)
 * callers and points them at the FIFO roles instead of letting the
 * queue synth with primary-queue alarm defaults that don't fit a FIFO
 * queue.
 */
function throwIfFifoPropsOnNonFifoRole(
  id: string,
  role: QueueRole,
  props: Partial<QueueProps>,
): void {
  for (const key of FIFO_ONLY_PROP_KEYS) {
    if (props[key] === undefined) continue;
    throw new Error(
      `QueueBuilder "${id}": "${key}" is FIFO-specific and not supported on role ` +
        `"${role}". Create the builder with ` +
        `createQueueBuilder("${isDlqRole(role) ? "fifo-dlq" : "fifo"}") instead.`,
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
 * No-op unless `props.fifo` is set (the FIFO roles merge `fifo: true`
 * before calling), so every role calls it unconditionally — the
 * validator owns both the invariants and their applicability.
 *
 * These are configuration errors, not advisory best practice, so they
 * throw (unlike the `maxReceiveCount` warning).
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/high-throughput-fifo.html
 */
function validateFifoQueueProps(id: string, props: Partial<QueueProps>): void {
  const { fifo, queueName, fifoThroughputLimit, deduplicationScope } = props;
  if (!fifo) return;

  if (queueName !== undefined && !Token.isUnresolved(queueName) && !queueName.endsWith(".fifo")) {
    throw new Error(
      `QueueBuilder "${id}": FIFO queues require a queueName ending in ".fifo"; ` +
        `got "${queueName}". Omit queueName to let CloudFormation generate one.`,
    );
  }

  if (
    fifoThroughputLimit === FifoThroughputLimit.PER_MESSAGE_GROUP_ID &&
    deduplicationScope !== DeduplicationScope.MESSAGE_GROUP
  ) {
    throw new Error(
      `QueueBuilder "${id}": fifoThroughputLimit=PER_MESSAGE_GROUP_ID (high-throughput ` +
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
function throwIfRedriveTargetFifoMismatch(
  id: string,
  fifo: boolean,
  deadLetterQueue: DeadLetterQueue | undefined,
): void {
  if (!deadLetterQueue) return;
  if (deadLetterQueue.queue.fifo === fifo) return;
  const [queueKind, targetKind] = fifo ? ["FIFO", "standard"] : ["standard", "FIFO"];
  throw new Error(
    `QueueBuilder "${id}": a ${queueKind} queue cannot redrive to the ${targetKind} ` +
      `dead-letter queue "${deadLetterQueue.queue.node.id}" — AWS requires the ` +
      `dead-letter queue to match the source queue's type. ` +
      `See https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html`,
  );
}

/**
 * Throws when a dead-letter-role queue is given its own
 * `deadLetterQueue` redrive policy — a DLQ is the terminal destination
 * for failed messages; a queue that redrives elsewhere is a primary
 * queue and belongs to the `"standard"` or `"fifo"` role.
 */
function throwIfRedriveOnDlqRole(id: string, role: QueueRole, props: Partial<QueueProps>): void {
  if (!props.deadLetterQueue) return;
  throw new Error(
    `QueueBuilder "${id}": deadLetterQueue is not supported on role "${role}" — a ` +
      `dead-letter queue is the terminal destination for failed messages. If this queue ` +
      `needs its own redrive policy it is a primary queue: create the builder with ` +
      `createQueueBuilder("${isFifoRole(role) ? "fifo" : "standard"}").`,
  );
}
