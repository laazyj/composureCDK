/**
 * Thrown when an {@link at} pin is built under a different construct id. Carries
 * both ids so callers can inspect or report the mismatch.
 *
 * Catch this by `name`, not `instanceof`: under the dual ESM/CJS build
 * (ADR-0007) the copy that threw may not be the copy the catching module
 * imported, and `instanceof` is realm-bound.
 */
export class BuildIdMismatchError extends Error {
  /**
   * @param pinnedId - The id the component was pinned to with `at()`.
   * @param buildId - The id it was built under instead.
   */
  constructor(
    public readonly pinnedId: string,
    public readonly buildId: string,
  ) {
    super(
      `at("${pinnedId}") was built under "${buildId}", so its pin would be lost and its ` +
        `resources replaced. compose() reads an at() pin only on a component's ` +
        `outermost object: make at() the outermost wrapper.`,
    );
    this.name = "BuildIdMismatchError";
  }
}
