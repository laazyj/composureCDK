import { describe, it } from "vitest";
import { runFixture } from "./run-fixture.js";

const FIXTURES = [
  { syntax: "CommonJS require()", fixture: "cjs/synth.js" },
  { syntax: "ESM import", fixture: "esm/synth.js" },
] as const;

/**
 * Each fixture is a tiny CDK app that loads `@composurecdk/*` packages and runs
 * `compose(...).build(app, id)` + `app.synth()` — the real `cdk synth` path
 * from issue #119. Spawning a fresh `node` per fixture exercises actual module
 * resolution (the `require`/`import` export conditions) and the `Ref` brand
 * across the dual-package boundary.
 */
describe.each(FIXTURES)("cdk synth via $syntax", ({ fixture }) => {
  it("synthesizes a ref-wired composed system", () => {
    runFixture(fixture);
  });
});
