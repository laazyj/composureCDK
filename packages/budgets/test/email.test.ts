import { describe, it, expect } from "vitest";
import { email } from "../src/email.js";

describe("email()", () => {
  it("brands a syntactically valid address", () => {
    const value = email("ops@example.com");
    expect(value).toBe("ops@example.com");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(email("  ops@example.com  ")).toBe("ops@example.com");
  });

  it("rejects empty input", () => {
    expect(() => email("")).toThrow(/empty/);
    expect(() => email("   ")).toThrow(/empty/);
  });

  it("rejects addresses over 50 characters", () => {
    const long = "a".repeat(46) + "@b.co"; // 51 chars
    expect(() => email(long)).toThrow(/exceeds 50/);
  });

  it("rejects strings without an @", () => {
    expect(() => email("not-an-email")).toThrow(/invalid email/);
  });

  it("rejects strings without a TLD", () => {
    expect(() => email("ops@example")).toThrow(/invalid email/);
  });

  it("rejects whitespace inside the address", () => {
    expect(() => email("ops @example.com")).toThrow(/invalid email/);
  });
});
