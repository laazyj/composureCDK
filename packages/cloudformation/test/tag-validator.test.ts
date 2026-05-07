import { describe, it, expect } from "vitest";
import { validateTag } from "../src/tag-validator.js";

describe("validateTag", () => {
  it("accepts a simple ASCII key/value pair", () => {
    expect(() => {
      validateTag("Project", "claude-rig");
    }).not.toThrow();
  });

  it("accepts an empty value", () => {
    expect(() => {
      validateTag("Owner", "");
    }).not.toThrow();
  });

  it("accepts the documented punctuation set in keys and values", () => {
    expect(() => {
      validateTag("cost-center.team_id:1", "value=foo+bar/baz@qux");
    }).not.toThrow();
  });

  it("accepts non-ASCII letters and digits", () => {
    expect(() => {
      validateTag("Équipe", "platforme");
    }).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() => {
      validateTag("", "value");
    }).toThrow(/non-empty/);
  });

  it("rejects keys longer than 128 characters", () => {
    const key = "a".repeat(129);
    expect(() => {
      validateTag(key, "value");
    }).toThrow(/128-character limit/);
  });

  it("accepts keys exactly 128 characters long", () => {
    const key = "a".repeat(128);
    expect(() => {
      validateTag(key, "value");
    }).not.toThrow();
  });

  it("rejects values longer than 256 characters", () => {
    const value = "v".repeat(257);
    expect(() => {
      validateTag("Owner", value);
    }).toThrow(/256-character limit/);
  });

  it("accepts values exactly 256 characters long", () => {
    const value = "v".repeat(256);
    expect(() => {
      validateTag("Owner", value);
    }).not.toThrow();
  });

  it("rejects keys starting with the reserved aws: prefix", () => {
    expect(() => {
      validateTag("aws:cloudformation:stackName", "x");
    }).toThrow(/reserved "aws:" prefix/);
  });

  it("rejects keys starting with AWS: case-insensitively", () => {
    expect(() => {
      validateTag("AWS:foo", "x");
    }).toThrow(/reserved "aws:" prefix/);
  });

  it("rejects characters outside the AWS tag character set in keys", () => {
    expect(() => {
      validateTag("bad!key", "value");
    }).toThrow(/character set/);
  });

  it("rejects characters outside the AWS tag character set in values", () => {
    expect(() => {
      validateTag("Owner", "bad!value");
    }).toThrow(/character set/);
  });
});
