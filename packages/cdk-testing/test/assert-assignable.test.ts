import { describe, it } from "vitest";
import { assertAssignable } from "../src/assert-assignable.js";

interface Wide {
  value?: string | number;
}

interface Narrow {
  value?: string;
}

// Every assertion here is `tsc`-only: vitest does not typecheck, so these fail
// the `typecheck` target rather than the test run. Each @ts-expect-error is
// itself an assertion — if the error stops happening, `tsc` reports the
// directive as unused and the suite fails that way instead.
describe("assertAssignable", () => {
  it("accepts a source assignable to the target", () => {
    assertAssignable<Wide, Narrow>();
  });

  it("rejects a source that is not — the guard's whole purpose", () => {
    // @ts-expect-error -- Wide is not assignable to Narrow: `value` may be a number
    assertAssignable<Narrow, Wide>();
  });

  it("does not distribute over a union source, unlike a conditional `extends`", () => {
    // `{ a: number }` is a member that does not satisfy the target, so the
    // union as a whole is not assignable. `expectTypeOf(...).toExtend()` would
    // pass this by testing each member separately.
    // @ts-expect-error -- the `{ a: number }` member is not assignable to `{ a: string }`
    assertAssignable<{ a: string }, { a: string } | { a: number }>();
  });

  it("requires both type arguments, so it cannot be vacuously satisfied", () => {
    // @ts-expect-error -- Expected 2 type arguments, but got 1
    assertAssignable<Narrow>();
  });
});
