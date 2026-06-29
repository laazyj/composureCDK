/**
 * Thrown when {@link compose} would build two components under the same construct
 * id in the same scope — typically because an explicit id from `at()` collides
 * with a sibling's id. Carries the offending id and component key so callers can
 * inspect or report the collision programmatically, and surfaces the failure at
 * composition time rather than as an opaque CDK duplicate-construct error deeper
 * in synth.
 */
export class DuplicateConstructIdError extends Error {
  /**
   * @param id - The construct id that two components share.
   * @param componentKey - The key of the component that triggered the collision.
   */
  constructor(
    public readonly id: string,
    public readonly componentKey: string,
  ) {
    super(
      `Duplicate construct id "${id}" for component "${componentKey}" in the same scope. ` +
        `An explicit id from at() must not collide with another component's id.`,
    );
    this.name = "DuplicateConstructIdError";
  }
}
