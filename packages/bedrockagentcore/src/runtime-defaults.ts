import type { RuntimeProps } from "aws-cdk-lib/aws-bedrockagentcore";

/**
 * Defaults applied to every runtime built with {@link createRuntimeBuilder}.
 * Each can be overridden through the builder.
 */
export const RUNTIME_DEFAULTS: Partial<RuntimeProps> = {
  /**
   * Deliver the runtime's traces to X-Ray. Tracing is the Agentic AI Lens's
   * baseline for diagnosing agent behaviour.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentops05-bp01.html
   */
  tracingEnabled: true,
};
