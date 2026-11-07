import { describe, expect, it } from "vitest";
import { Aws } from "aws-cdk-lib";
import { constraints, target } from "../src/index.js";

describe("target", () => {
  it.each([
    ["root", "r-ab12"],
    ["root", `r-${"a".repeat(32)}`],
    ["ou", "ou-ab12-cdef3456"],
    ["account", "123456789012"],
  ] as const)("accepts a valid %s ID %s", (kind, id) => {
    expect(target[kind](id)).toBe(id);
    expect(() => {
      constraints.validate.policyTargetId(id);
    }).not.toThrow();
  });

  it.each([
    ["root", "r-ab1"],
    ["root", "r-AB12"],
    ["root", "ou-ab12-cdef3456"],
    ["ou", "ou-ab12-cdef345"],
    ["ou", "ou-ab12"],
    ["account", "12345678901"],
    ["account", "1234567890123"],
  ] as const)("rejects a malformed %s ID %s", (kind, id) => {
    expect(() => target[kind](id)).toThrow(/is invalid\. Allowed: /);
  });

  it("brands an unresolved token unchecked", () => {
    expect(target.account(Aws.ACCOUNT_ID)).toBe(Aws.ACCOUNT_ID);
    expect(() => {
      constraints.validate.policyTargetId(Aws.ACCOUNT_ID);
    }).not.toThrow();
  });

  it("rejects a value that is no kind of target", () => {
    expect(() => {
      constraints.validate.policyTargetId("arn:aws:organizations::1:ou/o-1/ou-1");
    }).toThrow(/a root ID .*, an organizational unit ID .* or a 12-digit account ID/);
  });
});
