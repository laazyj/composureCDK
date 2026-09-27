import type { Environment } from "aws-cdk-lib";

/**
 * The fictitious AWS account {@link testEnv} builds environments on.
 *
 * CDK renders the account into ARNs, so a suite asserting on synthesised
 * output needs a stable value. `123456789012` is the account AWS's own
 * documentation uses for examples.
 *
 * A suite that hard-codes an ARN should build it from this constant; repeating
 * the digits lets the ARN and the stack's account drift apart silently.
 * A cross-account suite keeps its own second literal — the difference between
 * the two accounts is what it asserts.
 */
export const TEST_ACCOUNT = "123456789012";

/**
 * A CDK {@link Environment} with `account` and `region` both required.
 *
 * CDK declares both optional, since an environment-agnostic stack supplies
 * neither. {@link testEnv} always supplies both, and a suite whose own fixture
 * type requires a `string` account cannot accept `Environment` without a cast.
 */
export interface TestEnvironment extends Environment {
  readonly account: string;
  readonly region: string;
}

/**
 * A {@link TestEnvironment} for `region`, on {@link TEST_ACCOUNT}.
 *
 * A function rather than one constant per region: the suites name five regions
 * between them, and each call returns a fresh object, so a test that mutates
 * what it is given cannot affect another.
 *
 * @example
 * ```ts
 * const stack = newStack({ env: testEnv("us-east-1") });
 * ```
 */
export function testEnv(region: string): TestEnvironment {
  return { account: TEST_ACCOUNT, region };
}
