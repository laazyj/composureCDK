/**
 * Asserts that {@link IBuilder.copy | `.copy()`} returns an independent
 * builder that preserves non-`props` state set via {@link COPY_STATE}.
 *
 * The helper is the standard way per-package tests verify each accumulator
 * a builder holds outside `props`. It executes the following sequence and
 * asserts the two invariants implied by ADR-0005:
 *
 * 1. Build a **baseline**: `factory()` then `configure()`.
 * 2. Build the **copy**: `factory()`, `configure()`, then `.copy()`.
 *    Apply `mutate()` to the original *after* the copy is taken.
 * 3. Build the **original** (now carrying both `configure` and `mutate`).
 *
 * Note that the baseline is constructed via `factory()` rather than via
 * `.copy()` — using `.copy()` would make the helper unable to detect a
 * broken `[COPY_STATE]`, since both the "baseline" and the "copy" would
 * drop the same state and still match.
 *
 * Then:
 *
 * - `inspect(copyResult)` must deep-equal `inspect(baselineResult)` —
 *   the copy preserved exactly the state that `configure` set up.
 *   A failure here means `[COPY_STATE]` is missing, incomplete, or buggy.
 * - `inspect(originalResult)` must deep-not-equal `inspect(baselineResult)` —
 *   `mutate` actually changed inspectable state. Without this sanity
 *   check, a no-op `mutate` would let the first assertion pass
 *   trivially, hiding an isolation bug.
 *
 * @param args.factory - Returns a fresh, unconfigured builder. Called
 *   twice — the helper builds two independent instances so that the
 *   build calls don't share construct scopes and so the baseline does
 *   not depend on `.copy()`.
 * @param args.configure - Applies the state under test (e.g. adds a
 *   `customAlarm`, configures `#vpc`, appends a `subscription`). Called
 *   on the baseline and on the original.
 * @param args.mutate - Applied to the original *after* the copy is taken.
 *   Must change something the `inspect` callback can see — typically a
 *   second `configure`-shaped call that adds another item to the
 *   accumulator under test.
 * @param args.build - Calls `.build(scope, id)` against a fresh CDK
 *   scope. Three separate scopes are required (one per build) — return a
 *   freshly constructed scope each call. Reusing a scope across calls
 *   surfaces as a CDK duplicate-id error rather than a silent leak.
 * @param args.inspect - Extracts the slice of the build result whose
 *   shape depends on the state under test (e.g.
 *   `result => Object.keys(result.alarms)`).
 *
 * @example
 * ```ts
 * import { App, Stack } from "aws-cdk-lib";
 * import { assertCopyPreservesState } from "@composurecdk/core/testing";
 *
 * assertCopyPreservesState({
 *   factory: () => createCertificateBuilder().domainName("example.com"),
 *   configure: (b) => b.customAlarm({ id: "FirstAlarm", ... }),
 *   mutate: (b) => b.customAlarm({ id: "SecondAlarm", ... }),
 *   build: (b) => b.build(new Stack(new App(), "S"), "Cert"),
 *   inspect: (r) => Object.keys(r.alarms).sort(),
 * });
 * ```
 */
export function assertCopyPreservesState<B extends { copy(): B }, R>(args: {
  factory: () => B;
  configure: (builder: B) => void;
  mutate: (builder: B) => void;
  build: (builder: B) => R;
  inspect: (result: R) => unknown;
}): void {
  const { factory, configure, mutate, build, inspect } = args;

  const baseline = factory();
  configure(baseline);
  const baselineState = inspect(build(baseline));

  const original = factory();
  configure(original);
  if (typeof (original as { copy?: unknown }).copy !== "function") {
    throw new Error(
      "assertCopyPreservesState: builder returned by `factory` has no `.copy()` method. " +
        "Pass a builder produced by `Builder()` / `taggedBuilder()` from `@composurecdk/core` / `@composurecdk/cloudformation`.",
    );
  }
  const copy = original.copy();
  mutate(original);

  const originalState = inspect(build(original));
  const copyState = inspect(build(copy));

  if (deepEqual(originalState, baselineState)) {
    throw new Error(
      "assertCopyPreservesState: `mutate` did not change inspectable state on the original — " +
        "the test cannot detect a leak through `.copy()`. Make `mutate` and `inspect` cover " +
        "the same accumulator.\n" +
        `  baseline: ${format(baselineState)}\n` +
        `  original: ${format(originalState)}`,
    );
  }
  if (!deepEqual(copyState, baselineState)) {
    throw new Error(
      "assertCopyPreservesState: `.copy()` did not preserve state set by `configure`. " +
        "The builder is missing, incomplete, or has a buggy `[COPY_STATE]` hook (see ADR-0005).\n" +
        `  baseline: ${format(baselineState)}\n` +
        `  copy:     ${format(copyState)}`,
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(b)) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRec = b as Record<string, unknown>;
  return aKeys.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(bRec, k) &&
      deepEqual((a as Record<string, unknown>)[k], bRec[k]),
  );
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
