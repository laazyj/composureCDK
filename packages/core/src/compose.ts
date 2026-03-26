import { Graph, alg, json } from "@dagrejs/graphlib";
import { type IConstruct } from "constructs";
import { CyclicDependencyError } from "./cyclic-dependency-error.js";
import { type Lifecycle } from "./lifecycle.js";
import { type StackStrategy } from "./stack-strategy.js";

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
 * A {@link Lifecycle} produced by {@link compose}, extended with methods
 * for controlling how components are routed to scopes during build.
 *
 * Because `ComposedSystem` extends `Lifecycle`, a composed system can be
 * nested as a component inside another `compose` call — composition is
 * recursive.
 */
export interface ComposedSystem<Components extends Record<string, Lifecycle>> extends Lifecycle<
  BuildResult<Components>
> {
  /**
   * Returns a new {@link Lifecycle} that routes components to specific scopes
   * (typically Stacks) during build. Components not listed in the map use the
   * default scope passed to `build`.
   *
   * Accepts any `IConstruct`, so `Stack`, `DeploymentStack`, or custom
   * subclasses all work.
   *
   * @param stacks - A partial map from component key to scope.
   * @returns A {@link Lifecycle} with stack routing applied.
   *
   * @example
   * ```ts
   * compose({ handler, api }, { handler: [], api: ["handler"] })
   *   .withStacks({ handler: serviceStack, api: apiStack })
   *   .build(app, "MySystem");
   * ```
   */
  withStacks(stacks: { [K in keyof Components]?: IConstruct }): Lifecycle<BuildResult<Components>>;

  /**
   * Returns a new {@link Lifecycle} that uses a {@link StackStrategy} to
   * determine each component's scope during build.
   *
   * @param strategy - The strategy that resolves scopes for components.
   * @returns A {@link Lifecycle} with strategy-based stack routing applied.
   *
   * @example
   * ```ts
   * compose({ handler, api, table }, { ... })
   *   .withStackStrategy(groupedStacks(
   *     key => key === "table" ? "persistence" : "service",
   *     (app, id) => new Stack(app, id),
   *   ))
   *   .build(app, "MySystem");
   * ```
   */
  withStackStrategy(strategy: StackStrategy): Lifecycle<BuildResult<Components>>;
}

/**
 * A composed system of {@link Lifecycle} components. Holds the dependency graph
 * built at composition time and traverses it in topological order during build.
 */
class ComposedLifecycle<
  Components extends Record<string, Lifecycle>,
> implements ComposedSystem<Components> {
  private readonly graph: Graph;

  constructor(
    private readonly components: Components,
    private readonly dependencies: { [Property in keyof Components]: Dependency<Components> },
  ) {
    this.graph = buildDependencyGraph(components, dependencies);
  }

  withStacks(stacks: { [K in keyof Components]?: IConstruct }): Lifecycle<BuildResult<Components>> {
    return {
      build: (scope: IConstruct, id: string) => this.buildWith(scope, id, stacks),
    };
  }

  withStackStrategy(strategy: StackStrategy): Lifecycle<BuildResult<Components>> {
    return {
      build: (scope: IConstruct, id: string) => {
        const stacks = Object.fromEntries(
          Object.keys(this.components).map((key) => [key, strategy.resolve(scope, id, key)]),
        ) as { [K in keyof Components]?: IConstruct };
        return this.buildWith(scope, id, stacks);
      },
    };
  }

  build(scope: IConstruct, id: string): BuildResult<Components> {
    return this.buildWith(scope, id);
  }

  private buildWith(
    scope: IConstruct,
    id: string,
    stacks?: { [K in keyof Components]?: IConstruct },
  ): BuildResult<Components> {
    const results: Record<string, object> = {};

    for (const key of alg.topsort(this.graph)) {
      const componentScope = stacks?.[key] ?? scope;
      const deps = (this.dependencies[key] ?? []) as string[];
      const context = Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
      results[key] = this.components[key].build(componentScope, `${id}/${key}`, context);
    }

    return results as BuildResult<Components>;
  }
}

/**
 * Composes a set of {@link Lifecycle} components into a single system that
 * manages their build order and dependency resolution.
 *
 * A directed acyclic graph is built eagerly from the declared dependencies.
 * Cyclic dependencies are detected at composition time and throw immediately.
 * When `build` is called, components are built in topological order, each
 * receiving the build outputs of its dependencies as its context.
 *
 * The returned {@link ComposedSystem} is a {@link Lifecycle}, so it can be
 * nested as a component in a larger `compose` call.
 *
 * @param components - A record of named {@link Lifecycle} components.
 * @param dependencies - For each component, the list of other component keys it depends on.
 * @returns A {@link ComposedSystem} whose build output is the combined {@link BuildResult} of all components.
 */
export function compose<Components extends Record<string, Lifecycle>>(
  components: Components,
  dependencies: { [Property in keyof Components]: Dependency<Components> },
): ComposedSystem<Components> {
  return new ComposedLifecycle(components, dependencies);
}
