import { Graph, alg, json } from "@dagrejs/graphlib";
import { type IConstruct } from "constructs";
import { CyclicDependencyError } from "./cyclic-dependency-error.js";
import { type Lifecycle } from "./lifecycle.js";

/**
 * Maps a record of {@link Lifecycle} components to a record of their build outputs.
 * Each property's type is derived from the return type of the corresponding
 * component's `build` method, preserving full type information through composition.
 *
 * @typeParam T - A record where every value implements {@link Lifecycle}.
 */
type BuildResult<T extends { [Property in keyof T]: Lifecycle }> = {
  [Property in keyof T]: ReturnType<T[Property]["build"]>;
};

/**
 * Declares which other components a component depends on within a system.
 * Dependencies are expressed as an array of component keys. During build,
 * the resolved outputs of these components are passed as the component's context.
 *
 * @typeParam Components - The full set of components in the system.
 */
type Dependency<Components extends Record<string, Lifecycle>> = (keyof Components)[];

/**
 * Builds a directed acyclic graph from component dependency declarations.
 * The graph is described declaratively as nodes and edges, then constructed
 * via {@link json.read}. Nodes are component keys, edges point from a
 * dependency to its dependent. Throws if the graph contains a cycle.
 */
function buildDependencyGraph<Components extends Record<string, Lifecycle>>(
  components: Components,
  dependencies: { [Property in keyof Components]: Dependency<Components> },
): Graph {
  const nodes = Object.keys(components).map((v) => ({ v }));

  const edges = Object.entries(dependencies as Record<string, string[]>).flatMap(([key, deps]) =>
    deps.map((dep) => ({ v: dep, w: key })),
  );

  const graph = json.read({
    options: { directed: true },
    nodes,
    edges,
  });

  if (!alg.isAcyclic(graph)) {
    throw new CyclicDependencyError(alg.findCycles(graph));
  }

  return graph;
}

/**
 * A composed system of {@link Lifecycle} components. Holds the dependency graph
 * built at composition time and traverses it in topological order during build.
 */
class ComposedLifecycle<Components extends Record<string, Lifecycle>> implements Lifecycle<
  BuildResult<Components>
> {
  private readonly graph: Graph;

  constructor(
    private readonly components: Components,
    private readonly dependencies: { [Property in keyof Components]: Dependency<Components> },
  ) {
    this.graph = buildDependencyGraph(components, dependencies);
  }

  build(scope: IConstruct, id: string): BuildResult<Components> {
    const results: Record<string, object> = {};

    for (const key of alg.topsort(this.graph)) {
      const deps = (this.dependencies[key] ?? []) as string[];
      const context = Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
      results[key] = this.components[key].build(scope, `${id}/${key}`, context);
    }

    return results as BuildResult<Components>;
  }
}

/**
 * Composes a set of {@link Lifecycle} components into a single `Lifecycle` that
 * manages their build order and dependency resolution.
 *
 * A directed acyclic graph is built eagerly from the declared dependencies.
 * Cyclic dependencies are detected at composition time and throw immediately.
 * When `build` is called, components are built in topological order, each
 * receiving the build outputs of its dependencies as its context.
 *
 * @param components - A record of named {@link Lifecycle} components.
 * @param dependencies - For each component, the list of other component keys it depends on.
 * @returns A {@link Lifecycle} whose build output is the combined {@link BuildResult} of all components.
 */
export function compose<Components extends Record<string, Lifecycle>>(
  components: Components,
  dependencies: { [Property in keyof Components]: Dependency<Components> },
): Lifecycle<BuildResult<Components>> {
  return new ComposedLifecycle(components, dependencies);
}
