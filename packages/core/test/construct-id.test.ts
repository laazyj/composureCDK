import { describe, it, expect } from "vitest";
import { constructId, sanitizeConstructId } from "../src/construct-id.js";

describe("sanitizeConstructId", () => {
  it("replaces the path separator with a dash", () => {
    expect(sanitizeConstructId("a/b")).toBe("a-b");
    expect(sanitizeConstructId("a/b/c")).toBe("a-b-c");
  });

  it("replaces control characters with a dash", () => {
    expect(sanitizeConstructId("a\nb")).toBe("a-b");
    expect(sanitizeConstructId("a\x00b")).toBe("a-b");
    expect(sanitizeConstructId("a\x7fb")).toBe("a-b");
  });

  it("leaves already-safe strings unchanged", () => {
    expect(sanitizeConstructId("apex")).toBe("apex");
    expect(sanitizeConstructId("_sip._tcp")).toBe("_sip._tcp");
    expect(sanitizeConstructId("MyResource-1")).toBe("MyResource-1");
  });

  it("handles the empty string", () => {
    expect(sanitizeConstructId("")).toBe("");
  });
});

describe("constructId", () => {
  it("joins parts with a dash", () => {
    expect(constructId("records", "a", "api")).toBe("records-a-api");
  });

  it("drops empty and falsy parts", () => {
    expect(constructId("zone", undefined, "www")).toBe("zone-www");
    expect(constructId("zone", null, "www")).toBe("zone-www");
    expect(constructId("zone", false, "www")).toBe("zone-www");
    expect(constructId("zone", "", "www")).toBe("zone-www");
  });

  it("sanitizes each part", () => {
    expect(constructId("records", "a/b")).toBe("records-a-b");
  });

  it("returns an empty string when every part is falsy", () => {
    expect(constructId(undefined, null, false, "")).toBe("");
  });
});
