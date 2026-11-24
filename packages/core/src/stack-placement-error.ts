/**
 * Thrown when a composed system's stack strategy does not place every
 * component, or places a key that is not a component. Carries both lists so
 * callers can inspect or report the problem programmatically.
 *
 * `withStacks` and `groupedStacks` leave a key unplaced when its stack source
 * is `undefined` or missing, so this one error reports every placement
 * problem, including keys the type cannot see, such as ones spread in from
 * `Object.fromEntries`. It also reports a component whose stack is built by
 * another component that it does not list as a dependency (ADR-0024), with the
 * failed resolution as its `cause`.
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
   * @param detail - What went wrong, when the lists alone don't say.
   * @param options - The error that caused this one, if any.
   */
  constructor(
    public readonly systemId: string,
    public readonly unplaced: readonly string[],
    public readonly unknown: readonly string[],
    detail?: string,
    options?: ErrorOptions,
  ) {
    super(
      `The stack strategy for "${systemId}" must place every component, and only components.` +
        (unplaced.length > 0 ? ` Not placed: ${unplaced.join(", ")}.` : "") +
        (unknown.length > 0 ? ` Not components: ${unknown.join(", ")}.` : "") +
        (detail ? ` ${detail}` : ""),
      options,
    );
    this.name = "StackPlacementError";
  }
}
