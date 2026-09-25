import type { IBedrockAgentRuntime } from "aws-cdk-lib/aws-bedrockagentcore";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps a native grant method as a capability helper. */
const capability =
  (apply: (runtime: IBedrockAgentRuntime, grantee: IGrantable) => void) =>
  (runtime: Resolvable<IBedrockAgentRuntime>): Grant<IGrantable> =>
    grantVia(runtime, apply);

/**
 * Consumer-side grant helpers for an AgentCore runtime. Pass one to a grantee
 * builder's `grant(...)`, e.g.
 * `createFunctionBuilder().grant(runtimeGrants.invoke(ref<RuntimeBuilderResult>("agent").get("runtime")))`.
 *
 * Each delegates to the runtime's native `grant*` method (ADR-0013). There is
 * no helper for CDK's combined `grantInvoke`: grant `invokeForUser` only to
 * callers that need it.
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html
 */
export const runtimeGrants = {
  /** Invoke the runtime and its endpoints (`bedrock-agentcore:InvokeAgentRuntime`). */
  invoke: capability((runtime, grantee) => {
    runtime.grantInvokeRuntime(grantee);
  }),
  /**
   * Invoke on behalf of a user identified by an ID the caller supplies
   * (`bedrock-agentcore:InvokeAgentRuntimeForUser`).
   */
  invokeForUser: capability((runtime, grantee) => {
    runtime.grantInvokeRuntimeForUser(grantee);
  }),
};
