import { describe, expect, it } from "vitest";
import { TEST_ACCOUNT, testEnv } from "../src/env.js";
import { newStack } from "../src/stack.js";

describe("testEnv", () => {
  it("names the requested region on the shared test account", () => {
    expect(testEnv("eu-west-2")).toEqual({ account: TEST_ACCOUNT, region: "eu-west-2" });
  });

  it("returns a fresh object, so a mutating test cannot poison another", () => {
    expect(testEnv("us-east-1")).not.toBe(testEnv("us-east-1"));
  });

  it("makes a stack environment-specific, so region resolves at synth time", () => {
    const stack = newStack({ env: testEnv("af-south-1") });

    expect(stack.region).toBe("af-south-1");
    expect(stack.account).toBe(TEST_ACCOUNT);
  });
});
