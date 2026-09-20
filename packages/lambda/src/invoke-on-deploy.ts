import { Annotations, Duration } from "aws-cdk-lib";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { InvocationType, Trigger } from "aws-cdk-lib/triggers";
import type { IConstruct } from "constructs";
import { addDependencies, type DependencySource } from "@composurecdk/core";

/**
 * Suppression id for the deploy-time invocation timeout guard. Stable and part
 * of the public surface — silence the warning with
 * `Annotations.of(scope).acknowledgeWarning(INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID)`,
 * so it must not be renamed casually.
 */
export const INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID = "@composurecdk/lambda:invoke-on-deploy-timeout";

/**
 * The deployment waits for the handler's response, so a handler that throws
 * fails the stack. An invariant of the action rather than a default: the
 * asynchronous alternative returns before the work happens, reporting success
 * whatever the handler did, so there is nothing to override to.
 *
 * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_tracking_change_management_deployment_management.html
 */
const INVOCATION_TYPE = InvocationType.REQUEST_RESPONSE;

/**
 * The trigger provider's own Lambda timeout. CDK builds that provider from
 * `CustomResourceProviderBase`, which defaults to 15 minutes, and `Trigger`
 * overrides nothing — so there is no seam to raise it through and no way to
 * read it back. Asserted against a synthesised template in the test suite, so
 * an `aws-cdk-lib` upgrade that changes the default fails loudly here rather
 * than quietly reopening the hang this ceiling exists to prevent.
 */
const PROVIDER_TIMEOUT = Duration.minutes(15);

/**
 * Added to the function's own `timeout` to derive the wait, and subtracted
 * from {@link PROVIDER_TIMEOUT} to derive {@link MAX_TIMEOUT} — the same slack
 * at both ends, for the same reason: whoever is waiting must outlive whoever
 * they are waiting for, or the error is never reported.
 */
const TIMEOUT_MARGIN = Duration.seconds(30);

/**
 * Ceiling for the wait. The provider must outlive the invocation it is waiting
 * on, or it dies mid-wait and posts nothing back to CloudFormation. `Trigger`
 * sets no `ServiceTimeout` on the custom resource, so that is not a failed
 * deployment — it is a *hung* one, until CloudFormation abandons the stack
 * operation of its own accord.
 */
const MAX_TIMEOUT = PROVIDER_TIMEOUT.minus(TIMEOUT_MARGIN);

/**
 * The wait applied when the function's own timeout is unset or a token, and so
 * yields no concrete value to derive from. Matches the CDK `Trigger` default.
 */
const FALLBACK_TIMEOUT = Duration.minutes(2);

/**
 * How {@link IFunctionBuilder.invokeOnDeploy | `.invokeOnDeploy()`} derives the
 * wait when the caller sets no {@link InvokeOnDeployOptions.timeout}. A public
 * mirror of this module's constants, exported for visibility and testing — the
 * rationale for each value is on the constant it mirrors.
 */
export const INVOKE_ON_DEPLOY_DEFAULTS = {
  /** @see {@link TIMEOUT_MARGIN} */
  timeoutMargin: TIMEOUT_MARGIN,

  /** @see {@link FALLBACK_TIMEOUT} */
  fallbackTimeout: FALLBACK_TIMEOUT,

  /** @see {@link MAX_TIMEOUT} */
  maxTimeout: MAX_TIMEOUT,
} as const;

/**
 * Options for {@link IFunctionBuilder.invokeOnDeploy | `.invokeOnDeploy()`}.
 */
export interface InvokeOnDeployOptions {
  /**
   * What must be fully provisioned before the handler runs — see
   * {@link DependencySource} for the shapes it takes and what each one reaches.
   *
   * The function's own execution role, and therefore every policy attached to
   * it by `.grant()` or `.configureRole()`, is already waited for. This is for
   * everything else the call depends on: the API it will call, the table it
   * will seed — and the resource behind any grant that writes a *resource*
   * policy rather than an identity one, such as a KMS key, since that half is
   * not attached to the role and so is not covered.
   */
  readonly after?: DependencySource[];

  /**
   * How long the deployment waits for the handler before failing the stack.
   *
   * Defaults to the function's own `timeout` plus
   * {@link INVOKE_ON_DEPLOY_DEFAULTS.timeoutMargin}, capped at
   * {@link INVOKE_ON_DEPLOY_DEFAULTS.maxTimeout}. Setting it at or below the
   * function's timeout warns under {@link INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID};
   * setting it above `maxTimeout` throws, because the provider would not
   * survive the wait to report anything.
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
 * The invocation is ordered after the function's execution role, so the policies
 * attached *to it* by `.grant()` / `.configureRole()` — which CloudFormation
 * does not otherwise sequence ahead of a custom resource — exist by the time the
 * handler runs.
 *
 * That reaches the identity half of a grant only: one that also writes a
 * resource policy (a KMS key policy, a cross-account bucket policy) leaves that
 * half in the granting resource's tree, and an imported role contributes no
 * resources to sequence at all. Both are the consumer's to declare through
 * {@link InvokeOnDeployOptions.after}, as is anything else the call needs.
 *
 * @internal
 */
export function createDeploymentTrigger(
  scope: IConstruct,
  id: string,
  handler: LambdaFunction,
  executionRole: IConstruct,
  options: InvokeOnDeployOptions,
  context: Record<string, object>,
): Trigger {
  const timeout = resolveWait(options.timeout, handler.timeout, id);
  warnOnShortWait(handler, id, timeout);

  const trigger = new Trigger(scope, `${id}DeploymentTrigger`, {
    handler,
    invocationType: INVOCATION_TYPE,
    timeout,
    executeOnHandlerChange: options.executeOnHandlerChange,
  });

  addDependencies(trigger, [executionRole, ...(options.after ?? [])], context);
  return trigger;
}

/**
 * How long the deployment waits.
 *
 * {@link MAX_TIMEOUT} binds both branches, but differently. A derived wait is
 * capped: the derivation is the library's, so quietly settling for less than it
 * wanted is the library's business. An explicit wait over the ceiling throws —
 * clamping would honour neither the duration the caller asked for nor the
 * failing deployment they expected, and there is no working form to fall back
 * to. Both are silent on a token, which has no value to compare.
 */
function resolveWait(
  explicitWait: Duration | undefined,
  handlerTimeout: Duration | undefined,
  id: string,
): Duration {
  if (explicitWait !== undefined) {
    const waitSeconds = concreteSeconds(explicitWait);
    if (waitSeconds !== undefined && waitSeconds > MAX_TIMEOUT.toSeconds()) {
      throw new Error(
        `FunctionBuilder "${id}": .invokeOnDeploy() was given a timeout of ${String(waitSeconds)}s, ` +
          `but the deployment cannot wait longer than ${String(MAX_TIMEOUT.toSeconds())}s — CDK's ` +
          `trigger provider runs with a ${String(PROVIDER_TIMEOUT.toSeconds())}s Lambda timeout ` +
          `and needs the remainder to report the result. A longer wait does not fail the ` +
          `deployment, it hangs it: the provider dies mid-invocation and CloudFormation is never ` +
          `told. Lower the timeout, or move work that needs longer out of the deployment.`,
      );
    }
    return explicitWait;
  }

  const handlerSeconds = concreteSeconds(handlerTimeout);
  if (handlerSeconds === undefined) return FALLBACK_TIMEOUT;

  const derived = handlerSeconds + TIMEOUT_MARGIN.toSeconds();
  return Duration.seconds(Math.min(derived, MAX_TIMEOUT.toSeconds()));
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
 * because the derived path can land here too: the cap leaves no margin once the
 * function's own timeout reaches {@link MAX_TIMEOUT}.
 * Silent whenever either value is a token, with nothing to compare.
 */
function warnOnShortWait(handler: LambdaFunction, id: string, wait: Duration): void {
  const waitSeconds = concreteSeconds(wait);
  const handlerSeconds = concreteSeconds(handler.timeout);
  if (waitSeconds === undefined || handlerSeconds === undefined) return;
  if (waitSeconds > handlerSeconds) return;

  Annotations.of(handler).addWarningV2(
    INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID,
    `FunctionBuilder "${id}": .invokeOnDeploy() waits ${String(waitSeconds)}s but the function's ` +
      `own timeout is ${String(handlerSeconds)}s — the deployment stops waiting while the handler ` +
      `is still running, so a slow call fails the stack as an abandoned invocation instead of ` +
      `reporting the handler's error. Give the deployment longer than the function's timeout (up ` +
      `to ${String(MAX_TIMEOUT.toSeconds())}s), shorten the function's ` +
      `timeout, or acknowledge "${INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID}".`,
  );
}
