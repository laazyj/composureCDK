import { expect } from "vitest";

/**
 * Asserts that `covered` names every capability `grants` exposes.
 *
 * A resource package's grant helpers are a plain object of capabilities —
 * `topicGrants.publish`, `bucketGrants.readWrite` — and its suite tests them
 * from a table. Nothing otherwise connects the two: a capability added to the
 * object without a row in the table is untested, silently and permanently.
 *
 * Call it from the suite's own `it`, so the test stays visible in the file:
 *
 * ```ts
 * const CAPABILITIES = [
 *   ["publish", "sns:Publish"],
 *   ["subscribe", "sns:Subscribe"],
 * ] as const;
 *
 * it("covers every capability topicGrants exposes", () => {
 *   assertCapabilitiesCovered(topicGrants, CAPABILITIES);
 * });
 * ```
 *
 * @param grants - The grant helpers under test. Only its keys are read.
 * @param covered - The capabilities the suite tests. Either the suite's own
 *   `it.each` table, whose first column is the capability, or a plain list of
 *   names where the suite tests each by hand.
 */
export function assertCapabilitiesCovered(
  grants: Readonly<Record<string, unknown>>,
  covered: readonly (string | readonly [string, ...unknown[]])[],
): void {
  const tested = covered.map((entry) => (typeof entry === "string" ? entry : entry[0]));
  expect(tested.sort()).toEqual(Object.keys(grants).sort());
}
