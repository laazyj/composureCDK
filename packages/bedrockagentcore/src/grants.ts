import type { IBedrockAgentRuntime, IMemory } from "aws-cdk-lib/aws-bedrockagentcore";
import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps a native grant method as a capability helper. */
const capability =
  <R>(apply: (resource: R, grantee: IGrantable) => void) =>
  (resource: Resolvable<R>): Grant<IGrantable> =>
    grantVia(resource, apply);

const onRuntime = capability<IBedrockAgentRuntime>;
const onMemory = capability<IMemory>;

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
  invoke: onRuntime((runtime, grantee) => {
    runtime.grantInvokeRuntime(grantee);
  }),
  /**
   * Invoke on behalf of a user identified by an ID the caller supplies
   * (`bedrock-agentcore:InvokeAgentRuntimeForUser`).
   */
  invokeForUser: onRuntime((runtime, grantee) => {
    runtime.grantInvokeRuntimeForUser(grantee);
  }),
};

/**
 * Consumer-side grant helpers for an AgentCore memory: data-plane access for
 * agents. Each delegates to the memory's native `grant*` method (ADR-0013).
 */
export const memoryGrants = {
  /** Record events (`CreateEvent`). */
  write: onMemory((memory, grantee) => {
    memory.grantWrite(grantee);
  }),
  /** Read short- and long-term memory. */
  read: onMemory((memory, grantee) => {
    memory.grantRead(grantee);
  }),
  /** Read events: short-term memory. */
  readShortTerm: onMemory((memory, grantee) => {
    memory.grantReadShortTermMemory(grantee);
  }),
  /** Read extracted memory records: long-term memory. */
  readLongTerm: onMemory((memory, grantee) => {
    memory.grantReadLongTermMemory(grantee);
  }),
  /** Record events and read short- and long-term memory: what an agent needs. */
  readWrite: onMemory((memory, grantee) => {
    memory.grantWrite(grantee);
    memory.grantRead(grantee);
  }),
  /** Delete events and memory records, e.g. for a data-erasure workflow. */
  delete: onMemory((memory, grantee) => {
    memory.grantDelete(grantee);
  }),
};
