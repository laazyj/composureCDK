import { App, Stack, type StackProps } from "aws-cdk-lib";

/**
 * Creates a `Stack` in a fresh `App` — the standard fixture for a suite that
 * synthesises a builder's output.
 *
 * Each call gets its own `App`, so repeated calls in one file cannot collide
 * on construct ids. A fixture that needs two stacks in one `App` is outside
 * this helper and should construct both directly.
 *
 * Pass `props.env` — see `testEnv` — for region- or account-sensitive
 * behaviour: region-partitioned service principals, `Stack.of(x).region`
 * lookups, ARNs that must resolve at synth time rather than as a token.
 *
 * @param props - Forwarded to the `Stack` constructor. Omit for an
 *   environment-agnostic stack.
 * @param id - The stack's construct id. Defaults to `"TestStack"`; it becomes
 *   the stack name in synthesised output, so override it only where a test
 *   asserts on that.
 */
export function newStack(props?: StackProps, id = "TestStack"): Stack {
  return new Stack(new App(), id, props);
}
