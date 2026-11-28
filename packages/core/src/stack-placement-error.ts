import { seeRule } from "./agent-rules.js";

/**
 * Thrown when a composed system's stack strategy does not place every
 * component, or places a key that is not a component. Carries both lists so
 * callers can inspect or report the problem programmatically.
 *
 * `withStacks` and `groupedStacks` leave a key unplaced when its stack source
 * is `undefined` or missing, so this one error reports every placement
 * problem, including keys the type cannot see, such as ones spread in from
 * `Object.fromEntries`.
 *
 * Catch this by `name`, not `instanceof`: under the dual ESM/CJS build
 * (ADR-0007) the copy that threw may not be the copy the catching module
 * imported, and `instanceof` is realm-bound.
 */
export class StackPlacementError extends Error {
  /**
   * @param systemId - The id the system was built under.
   * @param unplaced - Component keys the strategy gave no scope.
   * @param unknown - Keys the strategy placed that are not components.
   */
  constructor(
    public readonly systemId: string,
    public readonly unplaced: readonly string[],
    public readonly unknown: readonly string[],
  ) {
    super(
      `The stack strategy for "${systemId}" must place every component, and only components.` +
        (unplaced.length > 0 ? ` Not placed: ${unplaced.join(", ")}.` : "") +
        (unknown.length > 0 ? ` Not components: ${unknown.join(", ")}.` : "") +
        seeRule("LAYER-9"),
    );
    this.name = "StackPlacementError";
  }
}
