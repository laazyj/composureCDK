import { Annotations, Token } from "aws-cdk-lib";
import type { FunctionProps } from "aws-cdk-lib/aws-lambda";
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

/**
 * Suppression id for the SQS visibility-timeout reminder. Stable and part of
 * the public surface — callers silence the warning with
 * `Annotations.of(scope).acknowledgeWarning(SQS_VISIBILITY_TIMEOUT_ANNOTATION)`,
 * so it must not be renamed casually.
 */
const SQS_VISIBILITY_TIMEOUT_ANNOTATION = "@composurecdk/lambda:sqs-visibility-timeout";

/**
 * Emits the cross-component invariant reminders for a single attached event
 * source. `FunctionBuilder` dispatches on {@link EventSourceKind} so it never
 * has to `instanceof` CDK internals — mirroring the kind-keyed contextual
 * alarm specs in `function-alarms.ts`.
 *
 * @internal
 */
export type EventSourceInvariantWarner = (
  scope: IConstruct,
  id: string,
  key: string,
  props: Pick<FunctionProps, "timeout">,
) => void;

/**
 * Per-kind invariant reminders, keyed by {@link EventSourceKind}. `undefined`
 * for a kind with no cross-component invariant to surface (e.g. a bare
 * escape-hatch source attached as `"unknown"`).
 *
 * @internal
 */
export const EVENT_SOURCE_INVARIANT_WARNERS: Record<
  EventSourceKind,
  EventSourceInvariantWarner | undefined
> = {
  sqs: warnSqsVisibilityTimeout,
  unknown: undefined,
};

/**
 * Reminds that the source queue's `visibilityTimeout` should be ≥ 6× the
 * consumer function's `timeout`.
 *
 * This is a **contextual reminder**, not a true comparison: the concrete
 * `Queue` construct does not expose `visibilityTimeout` (only `QueueProps`
 * carries it), so a consuming builder that receives the queue via `ref()`
 * cannot read the value to compare it (tracked in laazyj/composureCDK#122).
 * We therefore state the function's own timeout and the computed 6× target
 * and leave the operator to confirm the queue side.
 */
function warnSqsVisibilityTimeout(
  scope: IConstruct,
  id: string,
  key: string,
  props: Pick<FunctionProps, "timeout">,
): void {
  const { timeout } = props;
  // No timeout means no 6× target to state — stay quiet rather than guess.
  if (timeout === undefined) return;

  const timeoutSeconds = timeout.toSeconds();
  // A timeout threaded through a CFN parameter is unknown at synth time;
  // a target derived from a token would be noise, not guidance.
  if (Token.isUnresolved(timeoutSeconds)) return;

  const target = timeoutSeconds * SQS_VISIBILITY_TIMEOUT_MULTIPLIER;
  Annotations.of(scope).addWarningV2(
    SQS_VISIBILITY_TIMEOUT_ANNOTATION,
    `FunctionBuilder "${id}": SQS event source "${key}" — consumer function timeout is ` +
      `${String(timeoutSeconds)}s; ensure the source queue's visibilityTimeout is >= ` +
      `${String(target)}s (${String(SQS_VISIBILITY_TIMEOUT_MULTIPLIER)}x) so Lambda can retry ` +
      `a throttled batch. See https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html`,
  );
}
