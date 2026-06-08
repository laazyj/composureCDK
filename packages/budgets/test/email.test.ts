import { describe, it, expect } from "vitest";
import { email } from "../src/email.js";
import { constraints } from "../src/index.js";

describe("email()", () => {
  it("brands a syntactically valid address", () => {
    const value = email("ops@example.com");
    expect(value).toBe("ops@example.com");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(email("  ops@example.com  ")).toBe("ops@example.com");
  });

  it("rejects empty input", () => {
    expect(() => email("")).toThrow(/is invalid/);
    expect(() => email("   ")).toThrow(/is invalid/);
  });

  it("rejects addresses over 50 characters", () => {
    const long = "a".repeat(46) + "@b.co"; // 51 chars
    expect(() => email(long)).toThrow(/50-character limit/);
  });

  it("rejects strings without an @", () => {
    expect(() => email("not-an-email")).toThrow(/is invalid/);
  });

  it("rejects strings without a TLD", () => {
    expect(() => email("ops@example")).toThrow(/is invalid/);
  });

  it("rejects whitespace inside the address", () => {
    expect(() => email("ops @example.com")).toThrow(/is invalid/);
  });
});

describe("constraints.validate.email", () => {
  it("is exposed through the package constraints namespace", () => {
    expect(() => {
      constraints.validate.email("ops@example.com");
    }).not.toThrow();
    expect(() => {
      constraints.validate.email("nope");
    }).toThrow(/Budgets subscriber email/);
  });
});
