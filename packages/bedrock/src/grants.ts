import { Grant as IamGrant, type IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";
import { type InferenceTarget, invocationStatements, scopeOf } from "./inference-target.js";

/**
 * Streaming operations (`InvokeModelWithResponseStream`, `ConverseStream`)
 * require both actions.
 *
 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html
 */
const INVOKE_ACTIONS = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"];

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
  invoke: (target: Resolvable<InferenceTarget>): Grant<IGrantable> =>
    grantVia(target, (resolved, grantee: IGrantable) => {
      const statements = invocationStatements(resolved, scopeOf(grantee.grantPrincipal));
      for (const { resourceArns, conditions } of statements) {
        IamGrant.addToPrincipal({ grantee, actions: INVOKE_ACTIONS, resourceArns, conditions });
      }
    }),
};
