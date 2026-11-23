import { describe, it, expect } from "vitest";
import { BuildIdMismatchError } from "../src/build-id-mismatch-error.js";
import { CyclicDependencyError } from "../src/cyclic-dependency-error.js";
import { DuplicateConstructIdError } from "../src/duplicate-construct-id-error.js";

// Consumers catch these by `name`, not `instanceof` (docs/architecture.md, Errors),
// so each name must stay equal to its class name.
describe("exported errors", () => {
  it.each([
    ["CyclicDependencyError", new CyclicDependencyError([["a", "b"]])],
    ["DuplicateConstructIdError", new DuplicateConstructIdError("id", "key")],
    ["BuildIdMismatchError", new BuildIdMismatchError("pinned", "built")],
  ])("%s sets name to its class name", (name, error) => {
    expect(error.name).toBe(name);
    expect(error.constructor.name).toBe(name);
  });
});
