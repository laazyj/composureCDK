import { Effect, Grant as IamGrant, type IGrantable, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { combine, type Grant, grantVia, type Resolvable } from "@composurecdk/core";
import type { GuardrailReference } from "./guardrail-builder.js";
import { type InferenceTarget, invocationStatements, scopeOf } from "./inference-target.js";

/**
 * Streaming operations (`InvokeModelWithResponseStream`, `ConverseStream`)
 * require both actions.
 *
 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html
 */
const INVOKE_ACTIONS = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"];

/** Options for {@link modelGrants.invoke}. */
export interface ModelInvokeGrantOptions {
  /**
   * Requires every invocation to apply this guardrail version. The allow is
   * conditioned on `bedrock:GuardrailIdentifier`, an explicit deny refuses
   * calls without it, and the grantee may apply the guardrail.
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions-id.html
   */
  requireGuardrail?: Resolvable<GuardrailReference>;
}

/** The versioned identifier `bedrock:GuardrailIdentifier` carries. */
function identifierOf(guardrail: GuardrailReference): string {
  return `${guardrail.guardrailArn}:${guardrail.version}`;
}

function grantInvoke(
  target: InferenceTarget,
  grantee: IGrantable,
  guardrail: GuardrailReference | undefined,
): void {
  const statements = invocationStatements(target, scopeOf(grantee.grantPrincipal));
  const identifier = guardrail && identifierOf(guardrail);
  for (const { resourceArns, conditions } of statements) {
    IamGrant.addToPrincipal({
      grantee,
      actions: INVOKE_ACTIONS,
      resourceArns,
      conditions: identifier
        ? {
            ...conditions,
            StringEquals: {
              ...conditions?.StringEquals,
              "bedrock:GuardrailIdentifier": identifier,
            },
          }
        : conditions,
    });
  }
  if (!guardrail) return;

  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      effect: Effect.DENY,
      actions: INVOKE_ACTIONS,
      resources: statements.flatMap((s) => s.resourceArns),
      conditions: { StringNotEquals: { "bedrock:GuardrailIdentifier": identifierOf(guardrail) } },
    }),
  );
  grantApply(guardrail, grantee);
}

function grantApply(guardrail: GuardrailReference, grantee: IGrantable): void {
  IamGrant.addToPrincipal({
    grantee,
    actions: ["bedrock:ApplyGuardrail"],
    resourceArns: [guardrail.guardrailArn],
  });
}

/**
 * Consumer-side grant helpers for invoking Amazon Bedrock models. Pass one to
 * a grantee builder's `grant(...)` — e.g.
 * `createFunctionBuilder().grant(modelGrants.invoke(profile))`.
 *
 * A model is not a construct, so there is no native `grant*` method to
 * delegate to; the statements are those the Bedrock user guide prescribes
 * (ADR-0013 addendum).
 */
export const modelGrants = {
  /**
   * Invoke the target through `InvokeModel`, `Converse` or their streaming
   * variants.
   *
   * For a cross-Region profile this also grants the foundation model in the
   * source Region and every Region the profile routes to, conditioned on
   * `bedrock:InferenceProfileArn` so those models are reachable only through
   * the profile.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp01.html
   */
  invoke: (
    target: Resolvable<InferenceTarget>,
    { requireGuardrail }: ModelInvokeGrantOptions = {},
  ): Grant<IGrantable> =>
    grantVia(
      combine({ target, guardrail: requireGuardrail }),
      ({ target: resolved, guardrail }, grantee: IGrantable) => {
        grantInvoke(resolved, grantee, guardrail);
      },
    ),
};

/**
 * Consumer-side grant helpers for Amazon Bedrock guardrails.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions-id.html
 */
export const guardrailGrants = {
  /**
   * Apply the guardrail (`bedrock:ApplyGuardrail`), through the
   * `ApplyGuardrail` API or a model invocation that names it.
   */
  apply: (guardrail: Resolvable<GuardrailReference>): Grant<IGrantable> =>
    grantVia(guardrail, (resolved, grantee: IGrantable) => {
      grantApply(resolved, grantee);
    }),
};
