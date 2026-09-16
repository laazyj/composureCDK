import { describe, expect, it } from "vitest";
import { assertCapabilitiesCovered } from "../src/assert-capabilities-covered.js";

const grants = { publish: () => undefined, subscribe: () => undefined };

describe("assertCapabilitiesCovered", () => {
  it("passes when a table's first column names every capability", () => {
    assertCapabilitiesCovered(grants, [
      ["publish", "sns:Publish"],
      ["subscribe", "sns:Subscribe"],
    ]);
  });

  it("passes when a plain list names every capability", () => {
    assertCapabilitiesCovered(grants, ["publish", "subscribe"]);
  });

  it("ignores ordering, so a table can read in whatever order suits it", () => {
    assertCapabilitiesCovered(grants, ["subscribe", "publish"]);
  });

  it("fails when a capability has no entry — the drift it exists to catch", () => {
    expect(() => {
      assertCapabilitiesCovered(grants, ["publish"]);
    }).toThrow();
  });

  it("fails when an entry names a capability that does not exist", () => {
    expect(() => {
      assertCapabilitiesCovered(grants, ["publish", "subscribe", "retract"]);
    }).toThrow();
  });
});
