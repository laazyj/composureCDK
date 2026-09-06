import type { IRuleTarget } from "aws-cdk-lib/aws-events";
import { SqsQueue, type SqsQueueProps } from "aws-cdk-lib/aws-events-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Wraps an SQS queue as an EventBridge {@link IRuleTarget}, deferring
 * resolution if the queue is a {@link Ref} to a sibling component's output.
 *
 * Mirrors the {@link SqsQueue} target from `aws-events-targets` — `props`
 * accepts {@link SqsQueueProps.message} for input transformation,
 * {@link SqsQueueProps.messageGroupId} (required for FIFO targets), plus the
 * `deadLetterQueue` / `maxEventAge` / `retryAttempts` reliability options
 * from the inherited base.
 *
 * The accepted type is read from CDK's own target constructor rather than
 * named as `IQueue`, so it keeps tracking the installed `aws-cdk-lib` as CDK
 * migrates its target constructors to the broader `*Ref` interfaces
 * (ADR-0018).
 */
export function sqsTarget(
  queue: Resolvable<ConstructorParameters<typeof SqsQueue>[0]>,
  props?: SqsQueueProps,
): Resolvable<IRuleTarget> {
  if (isRef(queue)) return queue.map((resolved) => new SqsQueue(resolved, props));
  return new SqsQueue(queue, props);
}
