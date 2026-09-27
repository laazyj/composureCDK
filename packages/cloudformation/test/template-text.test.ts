import { describe, it, expect } from "vitest";
import { Lazy } from "aws-cdk-lib";
import {
  sanitizeTemplateText,
  transliterate,
  validateTemplateText,
} from "../src/constraints/template-text.js";

describe("validateTemplateText", () => {
  it("accepts printable ASCII", () => {
    expect(() => {
      validateTemplateText("Order processor - consumes and processes order messages");
    }).not.toThrow();
  });

  it("accepts tab, newline and carriage return", () => {
    expect(() => {
      validateTemplateText("line one\nline\ttwo\r\n");
    }).not.toThrow();
  });

  it.each([
    ["em dash", "low — baseline", "U+2014"],
    ["en dash", "3 – 5 minutes", "U+2013"],
    ["left curly quote", "the “value”", "U+201C"],
    ["right curly quote", "the value’s length", "U+2019"],
    ["ellipsis", "and so on…", "U+2026"],
  ])("rejects %s", (_name, value, codePoint) => {
    expect(() => {
      validateTemplateText(value);
    }).toThrow(codePoint);
  });

  it("names the character, its index and the AWS doc", () => {
    expect(() => {
      validateTemplateText("ab—cd");
    }).toThrow(/U\+2014 "—" at index 2[\s\S]*template-anatomy/);
  });

  it("lists at most three offenders and counts the rest", () => {
    expect(() => {
      validateTemplateText("—————");
    }).toThrow("and 2 more");
  });

  it("uses the supplied label so a caller can name the field", () => {
    expect(() => {
      validateTemplateText("—", "Stack/Alarm: AWS::CloudWatch::Alarm alarmDescription");
    }).toThrow("Stack/Alarm: AWS::CloudWatch::Alarm alarmDescription contains");
  });

  it("skips unresolved tokens — their value is not knowable at synth", () => {
    expect(() => {
      validateTemplateText(Lazy.string({ produce: () => "—" }));
    }).not.toThrow();
  });
});

describe("sanitizeTemplateText", () => {
  it("leaves legal text untouched", () => {
    expect(sanitizeTemplateText("plain ASCII")).toBe("plain ASCII");
  });

  it("replaces per character, not per run, so a quoted phrase survives", () => {
    expect(sanitizeTemplateText("the “value” of x")).toBe('the "value" of x');
  });

  it("maps the common typographic characters to readable ASCII", () => {
    expect(sanitizeTemplateText("low — baseline… x ≥ 5")).toBe("low - baseline... x >= 5");
  });

  it("falls back to `?` — exactly what CloudFormation would have stored", () => {
    expect(sanitizeTemplateText("status: 🚀")).toBe("status: ?");
  });

  it("accepts a custom replacement", () => {
    expect(sanitizeTemplateText("a—b", () => "~")).toBe("a~b");
  });

  it("returns unresolved tokens unchanged", () => {
    const token = Lazy.string({ produce: () => "—" });
    expect(sanitizeTemplateText(token)).toBe(token);
  });

  it("produces output that validates", () => {
    expect(() => {
      validateTemplateText(sanitizeTemplateText("— “x” … 🚀"));
    }).not.toThrow();
  });
});

describe("transliterate", () => {
  it("maps a known character", () => {
    expect(transliterate("—")).toBe("-");
  });

  it("maps an unknown character to `?`", () => {
    expect(transliterate("漢")).toBe("?");
  });
});
