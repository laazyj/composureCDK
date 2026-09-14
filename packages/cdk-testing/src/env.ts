import type { Environment } from "aws-cdk-lib";

/**
 * The fictitious AWS account {@link testEnv} builds environments on.
 *
 * CDK renders the account into ARNs, so a suite asserting on synthesised
 * output needs a stable value. `123456789012` is the account AWS's own
 * documentation uses for examples; it is not a real account.
 *
 * A suite that also hard-codes an ARN must build it from this constant rather
 * than repeating the digits — otherwise the ARN and the stack's account drift
 * apart silently, and the assertion passes against an account the stack is
 * not in.
 *
 * A cross-account suite owns its own second literal. The distinction between
 * two accounts is what such a test asserts, so collapsing both onto this
 * constant would quietly delete the invariant under test.
 */
export const TEST_ACCOUNT = "123456789012";

/**
 * An environment-specific {@link Environment} for `region`, on
 * {@link TEST_ACCOUNT}.
 *
 * A function rather than a constant per region, for two reasons: the suites
 * between them name five regions and gain more whenever one tests a
 * region-partitioned behaviour, and each call returns a fresh object, so a
 * test that mutates what it is given cannot poison another.
 *
 * @example
 * ```ts
 * const stack = newStack({ env: testEnv("us-east-1") });
 * ```
 */
export function testEnv(region: string): Environment {
  return { account: TEST_ACCOUNT, region };
}
