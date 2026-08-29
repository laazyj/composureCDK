import { Annotations, Duration } from "aws-cdk-lib";
import type { IRole } from "aws-cdk-lib/aws-iam";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { InvocationType, Trigger } from "aws-cdk-lib/triggers";
import type { IConstruct } from "constructs";
import { resolve, type Resolvable } from "@composurecdk/core";

/**
 * Suppression id for the deploy-time invocation timeout guard. Stable and part
 * of the public surface — silence the warning with
 * `Annotations.of(scope).acknowledgeWarning(DEPLOY_INVOKE_TIMEOUT_WARNING_ID)`,
 * so it must not be renamed casually.
 */
export const DEPLOY_INVOKE_TIMEOUT_WARNING_ID = "@composurecdk/lambda:deploy-invoke-timeout";

/**
 * The deployment waits for the handler's response, so a handler that throws
 * fails the stack. An invariant of the action rather than a default: the
 * asynchronous alternative returns before the work happens, reporting success
 * whatever the handler did, so there is nothing to override to.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_tracking_change_management_deployment_management.html
 */
const DEPLOYMENT_INVOCATION_TYPE = InvocationType.REQUEST_RESPONSE;

/**
 * How {@link IFunctionBuilder.invokeOnDeploy | `.invokeOnDeploy()`} derives the
 * wait when the caller sets no {@link InvokeOnDeployOptions.timeout}. Exported
 * for visibility and testing.
 */
export const DEPLOYMENT_INVOKE_DEFAULTS = {
  /**
   * Added to the function's own `timeout` to derive how long the deployment
   * waits, so a handler that runs to its limit still reports *its* error
   * ("Task timed out after …") rather than the deployment abandoning the call
   * first and reporting a less actionable trigger timeout.
   */
  timeoutMargin: Duration.seconds(30),

  /**
   * The wait applied when the function's own timeout is unset or a token, and
   * so yields no concrete value to derive from. Matches the CDK `Trigger`
   * default.
   */
  fallbackTimeout: Duration.minutes(2),

  /**
   * Ceiling for the derived wait: the CDK trigger provider's own Lambda runs
   * with a 15-minute timeout, so waiting longer is not something the library
   * can honour.
   */
  maxTimeout: Duration.minutes(15),
} as const;

/**
 * Options for {@link IFunctionBuilder.invokeOnDeploy | `.invokeOnDeploy()`}.
 */
export interface InvokeOnDeployOptions {
  /**
   * Constructs that must be fully provisioned before the handler runs, as
   * concrete constructs or {@link Resolvable} references to sibling components
   * (`ref("api", (r) => r.api)`).
   *
   * The function's own execution role — and therefore every policy attached to
   * it by `.grant()` or `.configureRole()` — is always waited for; this is for
   * everything else the call depends on, such as the API it will call or the
   * table it will seed.
   */
  readonly after?: Resolvable<IConstruct>[];

  /**
   * How long the deployment waits for the handler before failing the stack.
   *
   * Defaults to the function's own `timeout` plus
   * {@link DEPLOYMENT_INVOKE_DEFAULTS.timeoutMargin}, capped at
   * {@link DEPLOYMENT_INVOKE_DEFAULTS.maxTimeout}. Setting this at or below the
   * function's timeout warns under {@link DEPLOY_INVOKE_TIMEOUT_WARNING_ID}.
   */
  readonly timeout?: Duration;

  /**
   * Re-invoke the handler whenever its code or configuration changes.
   *
   * `true` (the default) binds the invocation to the function's current
   * version, so it re-runs on a handler change and is a no-op on unrelated
   * stack updates — right for an idempotent registration. `false` invokes only
   * on the stack's *first* deployment. Neither setting invokes on every
   * deployment; that is not something CDK's `Trigger` offers.
   */
  readonly executeOnHandlerChange?: boolean;
}

/**
 * Creates the custom resource that invokes `handler` during deployment and
 * fails the stack if it errors.
 *
 * The invocation is ordered after the function's execution role, so policies
 * attached by `.grant()` / `.configureRole()` — which CloudFormation does not
 * otherwise sequence ahead of a custom resource — exist by the time the handler
 * runs. Anything else the call needs comes through
 * {@link InvokeOnDeployOptions.after}.
 *
 * @internal
 */
export function createDeploymentInvocation(
  scope: IConstruct,
  id: string,
  handler: LambdaFunction,
  executionRole: IRole,
  options: InvokeOnDeployOptions,
  context: Record<string, object>,
): Trigger {
  const timeout = options.timeout ?? derivedWait(handler.timeout);
  warnOnShortWait(handler, id, timeout);

  return new Trigger(scope, `${id}DeploymentTrigger`, {
    handler,
    invocationType: DEPLOYMENT_INVOCATION_TYPE,
    timeout,
    executeOnHandlerChange: options.executeOnHandlerChange,
    executeAfter: [executionRole, ...(options.after ?? []).map((t) => resolve(t, context))],
  });
}

/**
 * The wait derived from the function's own timeout when the caller did not set
 * one: long enough for the handler to reach its limit and report its own error,
 * and never longer than the trigger provider can honour.
 */
function derivedWait(handlerTimeout: Duration | undefined): Duration {
  const handlerSeconds = concreteSeconds(handlerTimeout);
  if (handlerSeconds === undefined) return DEPLOYMENT_INVOKE_DEFAULTS.fallbackTimeout;

  const derived = handlerSeconds + DEPLOYMENT_INVOKE_DEFAULTS.timeoutMargin.toSeconds();
  return Duration.seconds(Math.min(derived, DEPLOYMENT_INVOKE_DEFAULTS.maxTimeout.toSeconds()));
}

/** A `Duration` in seconds, or `undefined` when it is unset or a token. */
function concreteSeconds(duration: Duration | undefined): number | undefined {
  if (duration === undefined || duration.isUnresolved()) return undefined;
  return duration.toSeconds();
}

/**
 * Warns when the deployment would stop waiting before the handler's own timeout
 * — a handler that runs long then fails the stack as an abandoned invocation
 * rather than reporting the error it was about to produce.
 *
 * Checked against the final wait, whether the caller set it or it was derived,
 * because the derived path can land here too: the cap leaves no margin for a
 * function timeout at Lambda's 15-minute maximum. Silent whenever either value
 * is a token, with nothing to compare.
 */
function warnOnShortWait(handler: LambdaFunction, id: string, wait: Duration): void {
  const waitSeconds = concreteSeconds(wait);
  const handlerSeconds = concreteSeconds(handler.timeout);
  if (waitSeconds === undefined || handlerSeconds === undefined) return;
  if (waitSeconds > handlerSeconds) return;

  Annotations.of(handler).addWarningV2(
    DEPLOY_INVOKE_TIMEOUT_WARNING_ID,
    `FunctionBuilder "${id}": .invokeOnDeploy() waits ${String(waitSeconds)}s but the function's ` +
      `own timeout is ${String(handlerSeconds)}s — the deployment stops waiting while the handler ` +
      `is still running, so a slow call fails the stack as an abandoned invocation instead of ` +
      `reporting the handler's error. Give the deployment longer than the function's timeout (up ` +
      `to ${String(DEPLOYMENT_INVOKE_DEFAULTS.maxTimeout.toMinutes())} minutes), shorten the ` +
      `function's timeout, or acknowledge "${DEPLOY_INVOKE_TIMEOUT_WARNING_ID}".`,
  );
}
