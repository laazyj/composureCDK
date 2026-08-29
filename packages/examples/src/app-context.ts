import { App, type AppProps } from "aws-cdk-lib";

/**
 * The CDK context every example app synthesises with.
 *
 * `cdk.json` carries the same map so the CLI (`cdk synth`, `cdk deploy`) and
 * the tests agree — the CLI passes its context through `CDK_CONTEXT_JSON`,
 * which `App` applies *after* `props.context`, so an accidental divergence
 * would silently give the tests one template and CI's deploy another. The
 * `app-context` test asserts the two stay in sync.
 *
 * Feature flags are deliberately declared rather than inherited. The examples
 * are the pattern users copy, so whatever they leave implicit becomes the
 * pattern people inherit — and CDK's unconfigured defaults shift between
 * releases (see issue #341).
 */
export const EXAMPLE_CONTEXT: Record<string, unknown> = {
  /**
   * Cross-stack references are weak: the consumer reads the producer's output
   * with `Fn::GetStackOutput` instead of importing a CloudFormation export.
   *
   * `"weak"` is CDK's recommended value; unconfigured, CDK behaves as
   * `"strong"` and warns that the choice was never made. Strong references
   * block the producer from being deleted or from removing an export while a
   * consumer still reads it — real protection for a long-lived system, and
   * exactly the wrong trade for stacks CI deploys and tears down on every run.
   *
   * The flag is read from the **consuming** stack's context and, despite what
   * its own description says, is not limited to cross-region references:
   * same-account same-region consumers resolve to `Fn::GetStackOutput` under
   * `"weak"` too, which is what the multi-stack example's snapshot shows.
   *
   * An already-deployed system migrating from strong must stage it —
   * `"both"`, deploy everywhere, then `"weak"` — because the producer's
   * exports cannot disappear while consumers still import them. Setting
   * `"weak"` directly is only safe from a clean slate, which is what the
   * examples are.
   */
  "@aws-cdk/core:defaultCrossStackReferences": "weak",
};

/**
 * Creates an `App` carrying {@link EXAMPLE_CONTEXT}.
 *
 * Every example defaults its `app` parameter to this rather than to a bare
 * `new App()`, so a stack synthesised by its own test sees the same context
 * the CLI supplies when CI deploys it.
 *
 * @param props - `App` props to merge; a `context` entry here wins over
 *   {@link EXAMPLE_CONTEXT}.
 * @returns A new `App` configured with the examples' context.
 */
export function exampleApp(props: AppProps = {}): App {
  return new App({ ...props, context: { ...EXAMPLE_CONTEXT, ...props.context } });
}
