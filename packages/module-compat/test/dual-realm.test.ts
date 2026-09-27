import { describe, it } from "vitest";
import { runFixture } from "./run-fixture.js";

/**
 * The resolution and synth suites load each package under one module syntax at
 * a time. These fixtures load a package under **both at once** in a single
 * process — the dual-package hazard proper (ADR-0007), where a value minted by
 * one copy is handed to the other and every `instanceof` across that boundary
 * is false. A fixture per class we brand with `Symbol.for(...)`.
 */
describe("both realms loaded in one process", () => {
  it("recognises a StatementBuilder across the boundary, guard included", () => {
    runFixture("dual-realm/statement-builder.js");
  });
});
