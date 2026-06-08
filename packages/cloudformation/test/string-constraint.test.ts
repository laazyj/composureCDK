import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  stringConstraint,
  validateString,
} from "../src/constraints/string-constraint.js";

const LOWER = stringConstraint({
  name: "Test Property",
  charClass: "a-z-",
  minLength: 2,
  maxLength: 6,
  allowed: "lowercase letters and hyphens",
  source: "https://example.test/constraint",
});

describe("stringConstraint", () => {
  it("derives an anchored, length-bounded pattern from the spec", () => {
    expect(LOWER.pattern.source).toBe("^[a-z-]{2,6}$");
    expect(LOWER.pattern.test("abc")).toBe(true);
    expect(LOWER.pattern.test("a")).toBe(false);
    expect(LOWER.pattern.test("abcdefg")).toBe(false);
  });

  it("compiles a global negated-class sanitisation pattern with matching flags", () => {
    const unicode = stringConstraint({
      name: "Unicode",
      charClass: "\\p{L}",
      allowed: "letters",
      source: "https://example.test",
      flags: "u",
    });
    expect(unicode.pattern.source).toBe("^[\\p{L}]{0,}$");
    expect(unicode.pattern.flags).toBe("u");
    expect(unicode.sanitizePattern?.source).toBe("[^\\p{L}]+");
    expect(unicode.sanitizePattern?.flags).toBe("gu");
  });
});

describe("validateString", () => {
  it("accepts a value within bounds and character set", () => {
    expect(() => {
      validateString("abc", LOWER);
    }).not.toThrow();
  });

  it("rejects a value below the minimum length", () => {
    expect(() => {
      validateString("a", LOWER);
    }).toThrow(/shorter than the 2-character minimum/);
  });

  it("rejects a value above the maximum length", () => {
    expect(() => {
      validateString("abcdefg", LOWER);
    }).toThrow(/exceeds the 6-character limit/);
  });

  it("rejects a value with disallowed characters, naming the allowed set and source", () => {
    expect(() => {
      validateString("aBc", LOWER);
    }).toThrow(/is invalid. Allowed: lowercase letters and hyphens. See https:\/\/example.test/);
  });
});

describe("sanitizeString", () => {
  it("replaces runs of disallowed characters with the replacement", () => {
    expect(sanitizeString("a/b c", LOWER)).toBe("a-b-c");
  });

  it("collapses a run of disallowed characters into a single replacement", () => {
    expect(sanitizeString("a???b", LOWER)).toBe("a-b");
  });

  it("truncates the result to the maximum length", () => {
    expect(sanitizeString("abcdefghij", LOWER)).toBe("abcdef");
  });

  it("accepts a custom replacement", () => {
    expect(sanitizeString("a/b", LOWER, "_")).toBe("a_b");
  });

  it("throws for a pattern-only constraint with no sanitisation pattern", () => {
    const patternOnly = {
      name: "Pattern only",
      pattern: /^[a-z]+$/,
      allowed: "lowercase letters",
      source: "https://example.test",
    };
    expect(() => sanitizeString("abc", patternOnly)).toThrow(/cannot be sanitised/);
  });
});
