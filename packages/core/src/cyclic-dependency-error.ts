import { seeRule } from "./agent-rules.js";

/**
 * Thrown when {@link compose} detects a cycle in the component dependency graph.
 * Carries the detected cycles so callers can inspect or report them programmatically.
 *
 * Catch this by `name`, not `instanceof`: under the dual ESM/CJS build
 * (ADR-0007) the copy that threw may not be the copy the catching module
 * imported, and `instanceof` is realm-bound.
 */
export class CyclicDependencyError extends Error {
  /**
   * @param cycles - Each element is an array of component keys forming a cycle.
   */
  constructor(public readonly cycles: string[][]) {
    super(
      `Cyclic dependencies detected: ${cycles.map((c) => c.join(" -> ")).join("; ")}. ` +
        "Remove or reverse one dependency in each cycle: the dependency map must have none." +
        seeRule("DECL-12"),
    );
    this.name = "CyclicDependencyError";
  }
}
