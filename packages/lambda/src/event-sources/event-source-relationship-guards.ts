import { Annotations, Aspects, CfnResource, type Duration, Token } from "aws-cdk-lib";
import type { Function as LambdaFunction, IEventSource } from "aws-cdk-lib/aws-lambda";
import type { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { CfnQueue, type IQueue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import type { EventSourceKind } from "./composure-event-source.js";

/**
 * AWS guidance: an SQS source queue's `visibilityTimeout` should be at least
 * this multiple of the consumer function's `timeout`, so Lambda has room to
 * retry a throttled batch before a message becomes visible again.
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html
 */
const SQS_VISIBILITY_TIMEOUT_MULTIPLIER = 6;

/** Lambda's own default `timeout` when none is set (CDK leaves it unset). */
const LAMBDA_DEFAULT_TIMEOUT_SECONDS = 3;

/** SQS's own default `visibilityTimeout` when none is set (applied by CloudFormation). */
const SQS_DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;

/**
 * Suppression id for the SQS visibility-timeout relationship guard. Stable and
 * part of the public surface — silence the warning with
 * `Annotations.of(scope).acknowledgeWarning(SQS_VISIBILITY_TIMEOUT_WARNING_ID)`,
 * so it must not be renamed casually.
 */
export const SQS_VISIBILITY_TIMEOUT_WARNING_ID = "@composurecdk/lambda:sqs-visibility-timeout";

/**
 * Guards a cross-component relationship that spans an attached event source and
 * its consumer function. `FunctionBuilder` dispatches on {@link EventSourceKind}
 * so it never has to `instanceof` CDK internals — see ADR-0011.
 *
 * @internal
 */
export type EventSourceRelationshipGuard = (
  fn: LambdaFunction,
  id: string,
  key: string,
  bound: IEventSource,
  timeout: Duration | undefined,
) => void;

/**
 * Per-kind relationship guards, keyed by {@link EventSourceKind}. A kind maps to
 * the (possibly empty) list of relationships to guard for a source of that kind
 * — SQS gains a second entry for the `maxReceiveCount` floor (#124), and a bare
 * escape-hatch source attached as `"unknown"` has none.
 *
 * @internal
 */
export const EVENT_SOURCE_RELATIONSHIP_GUARDS: Record<
  EventSourceKind,
  EventSourceRelationshipGuard[]
> = {
  sqs: [guardSqsVisibilityTimeout],
  dynamodb: [],
  unknown: [],
};

/**
 * The source queue behind a bound SQS event source. Safe cast: only reached for
 * the `"sqs"` kind, whose source `sqsEventSource()` constructs as an
 * {@link SqsEventSource} in the same call. `SqsEventSource.queue` is a public
 * getter.
 */
function sqsQueue(bound: IEventSource): IQueue {
  return (bound as SqsEventSource).queue;
}

/**
 * Warns when the source queue's `visibilityTimeout` is below 6× the consumer
 * function's `timeout`. Registers a synth-time Aspect so it reads the queue's
 * *final* value off its L1 `CfnQueue` — the value the L2 `Queue` does not
 * re-expose — regardless of build order or later mutation (ADR-0011).
 */
function guardSqsVisibilityTimeout(
  fn: LambdaFunction,
  id: string,
  key: string,
  bound: IEventSource,
  timeout: Duration | undefined,
): void {
  const queue = sqsQueue(bound);

  Aspects.of(fn).add({
    visit(node: IConstruct): void {
      // The Aspect visits fn and its subtree; act once, against fn itself.
      if (node !== fn) return;

      const target = targetVisibilityTimeoutSeconds(timeout);
      if (target === undefined) return; // token timeout — no concrete target to compare

      const actual = readVisibilityTimeoutSeconds(queue);
      if (actual === undefined || actual >= target) return; // unknowable or compliant — stay quiet

      Annotations.of(fn).addWarningV2(
        SQS_VISIBILITY_TIMEOUT_WARNING_ID,
        `FunctionBuilder "${id}": SQS event source "${key}" — source queue visibilityTimeout is ` +
          `${String(actual)}s but should be >= ${String(target)}s ` +
          `(${String(SQS_VISIBILITY_TIMEOUT_MULTIPLIER)}x the function timeout) so Lambda can retry ` +
          `a throttled batch. See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html`,
      );
    },
  });
}

/**
 * The 6× target in seconds, derived from the function timeout (or Lambda's 3s
 * default). `undefined` when the timeout is a token, which has no concrete
 * target at synth time. Guards `isUnresolved` *before* converting, so a token
 * Duration never reaches `toSeconds()`.
 */
function targetVisibilityTimeoutSeconds(timeout: Duration | undefined): number | undefined {
  if (timeout === undefined) {
    return SQS_VISIBILITY_TIMEOUT_MULTIPLIER * LAMBDA_DEFAULT_TIMEOUT_SECONDS;
  }
  if (timeout.isUnresolved()) return undefined;
  return SQS_VISIBILITY_TIMEOUT_MULTIPLIER * timeout.toSeconds();
}

/**
 * The queue's resolved `visibilityTimeout` in seconds, read off its L1
 * `CfnQueue` (the L2 `Queue` does not re-expose it). `undefined` when the queue
 * is imported (no L1 child) or the value is an unresolved token; `30` (the SQS
 * default) when the L1 carries no explicit value.
 */
function readVisibilityTimeoutSeconds(queue: IQueue): number | undefined {
  const child = queue.node.defaultChild;
  if (
    child === undefined ||
    !CfnResource.isCfnResource(child) ||
    child.cfnResourceType !== CfnQueue.CFN_RESOURCE_TYPE_NAME
  ) {
    return undefined;
  }

  const value = (child as CfnQueue).visibilityTimeout;
  if (value === undefined) return SQS_DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
  return Token.isUnresolved(value) ? undefined : value;
}
