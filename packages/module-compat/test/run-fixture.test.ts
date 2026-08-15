import { describe, expect, it } from "vitest";
import { runFixture } from "./run-fixture.js";

/**
 * Every other suite in this package trusts `runFixture` to turn a child's
 * non-zero exit into a test failure. If it ever swallowed one, the fixtures
 * would all report green while proving nothing — so assert the failure path
 * directly, including that the child's stderr reaches the message.
 */
describe("runFixture", () => {
  it("fails the test with the child's stderr when the fixture exits non-zero", () => {
    expect(() => {
      runFixture("failing/exit-nonzero.js");
    }).toThrow(/failing\/exit-nonzero\.js" failed:[\s\S]*fixture failed on purpose/);
  });

  it("falls back to the exec error when the fixture fails silently", () => {
    expect(() => {
      runFixture("failing/silent.js");
    }).toThrow(/failing\/silent\.js" failed:[\s\S]*Command failed/);
  });
});
