import { Effect, Grant as IamGrant, type IGrantable, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { combine, type Grant, grantVia, type Resolvable } from "@composurecdk/core";
import type { GuardrailReference } from "./guardrail-builder.js";
import { bedrockArn, environmentOf } from "./arn.js";
import {
  type InferenceTarget,
  type InvocationStatement,
  invocationStatements,
  scopeOf,
} from "./inference-target.js";

const INVOKE_ACTION = "bedrock:InvokeModel";

/**
 * Streaming operations (`InvokeModelWithResponseStream`, `ConverseStream`)
 * require both actions.
 *
 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html
 */
const INVOKE_ACTIONS = [INVOKE_ACTION, "bedrock:InvokeModelWithResponseStream"];

/** Options for {@link modelGrants.invoke}. */
export interface ModelInvokeGrantOptions {
  /**
   * Requires every invocation to apply a guardrail. The allow is conditioned
   * on `bedrock:GuardrailIdentifier`, an explicit deny refuses calls without
   * it, and the grantee may apply the guardrail.
   *
   * A reference requires that guardrail version. `"any"` requires some
   * guardrail in the grantee's account and Region, for a workload that picks
   * its guardrail at run time; prefer a reference where the guardrail is
   * known at synth.
   *
   * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-permissions-id.html
   */
  requireGuardrail?: Resolvable<GuardrailReference | "any">;
  /**
   * Whether to grant `bedrock:InvokeModelWithResponseStream` alongside
   * `bedrock:InvokeModel`. Set `false` for a caller that never streams.
   *
   * @default true
   */
  streaming?: boolean;
}

/** How a guardrail requirement is written into the invoke statements. */
interface GuardrailRequirement {
  /** Whether {@link identifier} is a `StringLike` pattern rather than an exact value. */
  readonly like: boolean;
  /** What `bedrock:GuardrailIdentifier` must match. */
  readonly identifier: string;
  /** The resource `bedrock:ApplyGuardrail` is granted on. */
  readonly applyArn: string;
}

/**
 * Every guardrail in `scope`'s account and Region. The versioned identifiers
 * `bedrock:GuardrailIdentifier` carries (`…:guardrail/<id>:<version>`) match
 * it as a `StringLike` pattern.
 */
function anyGuardrailArn(scope: IConstruct | undefined): string {
  const { partition, region, account } = environmentOf(scope);
  return bedrockArn(partition, "guardrail", "*", region, account);
}

function requirementOf(
  guardrail: GuardrailReference | "any",
  scope: IConstruct | undefined,
): GuardrailRequirement {
  if (guardrail === "any") {
    const arn = anyGuardrailArn(scope);
    return { like: true, identifier: arn, applyArn: arn };
  }
  return {
    like: false,
    identifier: `${guardrail.guardrailArn}:${guardrail.version}`,
    applyArn: guardrail.guardrailArn,
  };
}

function withGuardrail(
  conditions: InvocationStatement["conditions"],
  required: GuardrailRequirement,
): NonNullable<InvocationStatement["conditions"]> {
  const match = required.like ? "StringLike" : "StringEquals";
  return {
    ...conditions,
    [match]: {
      ...conditions?.[match],
      "bedrock:GuardrailIdentifier": required.identifier,
    },
  };
}

function grantInvoke(
  target: InferenceTarget,
  grantee: IGrantable,
  guardrail: GuardrailReference | "any" | undefined,
  streaming: boolean,
): void {
  const scope = scopeOf(grantee.grantPrincipal);
  const actions = streaming ? INVOKE_ACTIONS : [INVOKE_ACTION];
  const statements = invocationStatements(target, scope);
  const required = guardrail && requirementOf(guardrail, scope);
  for (const { resourceArns, conditions } of statements) {
    IamGrant.addToPrincipal({
      grantee,
      actions,
      resourceArns,
      conditions: required ? withGuardrail(conditions, required) : conditions,
    });
  }
  if (!required) return;

  grantee.grantPrincipal.addToPrincipalPolicy(
    new PolicyStatement({
      effect: Effect.DENY,
      actions,
      resources: statements.flatMap((s) => s.resourceArns),
      conditions: {
        [required.like ? "StringNotLike" : "StringNotEquals"]: {
          "bedrock:GuardrailIdentifier": required.identifier,
        },
      },
    }),
  );
  grantApply(required.applyArn, grantee);
}

function grantApply(guardrailArn: string, grantee: IGrantable): void {
  IamGrant.addToPrincipal({
    grantee,
    actions: ["bedrock:ApplyGuardrail"],
    resourceArns: [guardrailArn],
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
   * For a cross-Region profile this also grants the foundation model, in
   * every Region or in the profile's listed `routingRegions`, conditioned on
   * `bedrock:InferenceProfileArn` so the model is reachable only through the
   * profile.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp01.html
   */
  invoke: (
    target: Resolvable<InferenceTarget>,
    { requireGuardrail, streaming = true }: ModelInvokeGrantOptions = {},
  ): Grant<IGrantable> =>
    grantVia(
      combine({ target, guardrail: requireGuardrail }),
      ({ target: resolved, guardrail }, grantee: IGrantable) => {
        grantInvoke(resolved, grantee, guardrail, streaming);
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
      grantApply(resolved.guardrailArn, grantee);
    }),
  /**
   * Apply any guardrail in the grantee's account and Region, for a caller
   * that may name one at run time. Where the guardrail is known, `apply` it;
   * where every call must carry one, `modelGrants.invoke(…, { requireGuardrail })`.
   */
  // A plain Grant rather than grantVia: there is no resource to resolve, only
  // the grantee's own account and Region.
  applyAny: (): Grant<IGrantable> => ({
    applyTo(grantee) {
      grantApply(anyGuardrailArn(scopeOf(grantee.grantPrincipal)), grantee);
    },
  }),
};
