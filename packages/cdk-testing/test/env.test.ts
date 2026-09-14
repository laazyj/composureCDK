import { describe, expect, it } from "vitest";
import type { Environment } from "aws-cdk-lib";
import { assertAssignable } from "../src/assert-assignable.js";
import { TEST_ACCOUNT, testEnv, type TestEnvironment } from "../src/env.js";
import { newStack } from "../src/stack.js";

describe("testEnv", () => {
  it("names the requested region on the shared test account", () => {
    expect(testEnv("eu-west-2")).toEqual({ account: TEST_ACCOUNT, region: "eu-west-2" });
  });

  it("returns a fresh object, so a mutating test cannot poison another", () => {
    expect(testEnv("us-east-1")).not.toBe(testEnv("us-east-1"));
  });

  it("promises both fields, so a caller needing a known account gets one", () => {
    // Guards against a future edit widening the return type back to CDK's
    // `Environment`, whose account and region are optional — the narrowing is
    // the reason a suite can use this where its own fixture type wants a
    // `string` account. `tsc`-only; vitest does not typecheck.
    assertAssignable<{ account: string; region: string }, TestEnvironment>();
    assertAssignable<Environment, TestEnvironment>();
  });

  it("makes a stack environment-specific, so region resolves at synth time", () => {
    const stack = newStack({ env: testEnv("af-south-1") });

    expect(stack.region).toBe("af-south-1");
    expect(stack.account).toBe(TEST_ACCOUNT);
  });
});
