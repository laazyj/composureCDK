import { describe, it, expect } from "vitest";
import { StackPlacementError } from "../src/stack-placement-error.js";

describe("StackPlacementError", () => {
  it("names only the lists that have keys", () => {
    expect(new StackPlacementError("sys", ["a"], []).message).toBe(
      'The stack strategy for "sys" must place every component, and only components. Not placed: a.',
    );
    expect(new StackPlacementError("sys", [], ["x", "y"]).message).toBe(
      'The stack strategy for "sys" must place every component, and only components. Not components: x, y.',
    );
  });

  it("is catchable by name, carrying both lists", () => {
    const error = new StackPlacementError("sys", ["a"], ["x"]);

    expect(error).toMatchObject({ name: "StackPlacementError", unplaced: ["a"], unknown: ["x"] });
  });
});
