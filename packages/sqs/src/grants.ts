import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IQueue}'s native grant methods as a capability helper. */
const capability =
  (apply: (queue: IQueue, grantee: IGrantable) => void) =>
  (queue: Resolvable<IQueue>): Grant<IGrantable> =>
    grantVia(queue, apply);

/**
 * Consumer-side grant helpers for an SQS queue. Pass one to a grantee builder's
 * `grant(...)` — e.g.
 * `role.grant(queueGrants.consume(ref("queue", (r) => r.queue)))`.
 *
 * Each delegates to the queue's native `grant*` method. See ADR-0013.
 */
export const queueGrants = {
  /** Receive and delete messages (`sqs:ReceiveMessage`, `DeleteMessage`, …). */
  consume: capability((queue, grantee) => {
    queue.grantConsumeMessages(grantee);
  }),
  /** Send messages (`sqs:SendMessage`, `GetQueueAttributes`, …). */
  send: capability((queue, grantee) => {
    queue.grantSendMessages(grantee);
  }),
  /** Purge the queue (`sqs:PurgeQueue`). */
  purge: capability((queue, grantee) => {
    queue.grantPurge(grantee);
  }),
};
