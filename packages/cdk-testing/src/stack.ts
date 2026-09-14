import { App, Stack, type StackProps } from "aws-cdk-lib";

/**
 * Creates a `Stack` in a fresh `App` — the standard fixture for a suite that
 * synthesises a builder's output.
 *
 * Each call gets its own `App`, so repeated calls inside one test file cannot
 * collide on construct ids and a test can never observe state another test
 * left behind.
 *
 * Pass `props.env` — see `testEnv` — to make the stack environment-specific,
 * which is what region- or account-sensitive behaviour needs: region-
 * partitioned service principals, `Stack.of(x).region` lookups, ARNs that must
 * resolve at synth time rather than as a token.
 *
 * @param props - Forwarded to the `Stack` constructor. Omit for an
 *   environment-agnostic stack.
 */
export function newStack(props?: StackProps): Stack {
  return new Stack(new App(), "TestStack", props);
}
