import { describe, it, expect } from "vitest";
import { alarmName, joinAlarmName, kebab } from "../src/alarm-name.js";

describe("alarmName", () => {
  it("returns the input verbatim when valid", () => {
    expect(alarmName("payments-prod/lambda/errors")).toBe("payments-prod/lambda/errors");
  });

  it("trims surrounding whitespace", () => {
    expect(alarmName("  foo-bar  ")).toBe("foo-bar");
  });

  it("rejects empty input", () => {
    expect(() => alarmName("")).toThrow(/empty/);
    expect(() => alarmName("   ")).toThrow(/empty/);
  });

  it("rejects names longer than 255 chars", () => {
    expect(() => alarmName("x".repeat(256))).toThrow(/255/);
  });

  it("accepts the full CloudWatch character set", () => {
    expect(() => alarmName("abc-_./#:()+ =@123")).not.toThrow();
  });

  it("rejects characters outside CloudWatch's allowed set", () => {
    expect(() => alarmName("oops!")).toThrow(/invalid characters/);
    expect(() => alarmName("a&b")).toThrow(/invalid characters/);
    expect(() => alarmName("a\nb")).toThrow(/invalid characters/);
  });
});

describe("kebab", () => {
  it.each([
    ["camelCase", "camel-case"],
    ["PascalCase", "pascal-case"],
    ["snake_case", "snake-case"],
    ["dotted.name", "dotted-name"],
    ["space separated", "space-separated"],
    ["numberOfNotificationsFailed", "number-of-notifications-failed"],
    ["HTTPServer", "http-server"],
    ["XMLParser", "xml-parser"],
    ["already-kebab", "already-kebab"],
    ["UPPER", "upper"],
    ["ABCDef", "abc-def"],
    ["", ""],
    ["__leading_trailing__", "leading-trailing"],
  ])("kebabs %p as %p", (input, expected) => {
    expect(kebab(input)).toBe(expected);
  });
});

describe("joinAlarmName", () => {
  it("joins kebabed segments with the default '/' separator", () => {
    expect(joinAlarmName(["MyStack", "siteAlerts", "numberOfNotificationsFailed"])).toBe(
      "my-stack/site-alerts/number-of-notifications-failed",
    );
  });

  it("supports a custom separator", () => {
    expect(joinAlarmName(["MyStack", "siteAlerts", "errors"], "-")).toBe(
      "my-stack-site-alerts-errors",
    );
  });

  it("drops empty segments after kebabing", () => {
    expect(joinAlarmName(["", "siteAlerts", "errors"])).toBe("site-alerts/errors");
  });

  it("validates the result", () => {
    expect(() => joinAlarmName([])).toThrow(/empty/);
  });
});
