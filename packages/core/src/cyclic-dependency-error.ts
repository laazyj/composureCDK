/**
 * Thrown when {@link compose} detects a cycle in the component dependency graph.
 * Carries the detected cycles so callers can inspect or report them programmatically.
 */
export class CyclicDependencyError extends Error {
  /**
   * @param cycles - Each element is an array of component keys forming a cycle.
   */
  constructor(public readonly cycles: string[][]) {
    super(`Cyclic dependencies detected: ${cycles.map((c) => c.join(" -> ")).join("; ")}`);
    this.name = "CyclicDependencyError";
  }
}
