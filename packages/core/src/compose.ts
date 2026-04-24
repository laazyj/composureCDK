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
 * A callback invoked after all components in a composed system have been
 * built. Receives the top-level scope, system id, the fully-typed build
 * results of every component, and a record mapping each component key to
 * the scope it was built into.
 *
 * `componentScopes` makes per-component scopes visible to hooks so they can
 * attach additional constructs to the same stack a given component was
 * routed to — useful under {@link ComposedSystem.withStacks} or
 * {@link ComposedSystem.withStackStrategy}, where different components may
 * live in different stacks.
 *
 * Domain-specific packages provide helper functions that return hooks. For
 * example, `@composurecdk/cloudformation` exports {@link outputs} which
 * creates `CfnOutput` constructs from {@link Ref}-based definitions.
 *
 * @typeParam T - The build result type of the composed system.
 *
 * @example
 * ```ts
 * const logResults: AfterBuildHook<{ site: BucketBuilderResult }> =
 *   (_scope, _id, results) => {
 *     console.log("Bucket:", results.site.bucket.bucketName);
 *   };
 * ```
 */
export type AfterBuildHook<T extends object> = (
  scope: IConstruct,
  id: string,
  results: T,
  componentScopes: { readonly [K in keyof T]: IConstruct },
) => void;

/**
 * A {@link Lifecycle} produced by {@link compose}, extended with methods
 * for controlling how components are routed to scopes and for registering
 * post-build hooks.
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
  withStacks(stacks: { [K in keyof Components]?: IConstruct }): ConfiguredSystem<Components>;

  /**
   * Returns a new {@link ConfiguredSystem} that uses a {@link StackStrategy}
   * to determine each component's scope during build. The returned system
   * supports further chaining of {@link ConfiguredSystem.afterBuild | .afterBuild()} hooks.
   *
   * Mutually exclusive with {@link withStacks} — calling one locks the
   * stack routing; further stack-routing methods are not available on the
   * returned {@link ConfiguredSystem}.
   *
   * @param strategy - The strategy that resolves scopes for components.
   * @returns A {@link ConfiguredSystem} with strategy-based stack routing applied.
   *
   * @example
   * ```ts
   * compose({ handler, api, table }, { ... })
   *   .withStackStrategy(groupedStacks(
   *     key => key === "table" ? "persistence" : "service",
   *     (app, id) => new Stack(app, id),
   *   ))
   *   .afterBuild(outputs({ ... }))
   *   .build(app, "MySystem");
   * ```
   */
  withStackStrategy(strategy: StackStrategy): ConfiguredSystem<Components>;

  /**
   * Returns a new {@link ConfiguredSystem} that invokes the given hook after
   * all components have been built. The hook receives the scope, system id,
   * and the fully-typed build results.
   *
   * Multiple hooks can be chained — each `.afterBuild()` appends to the
   * hook list and returns the same {@link ConfiguredSystem} for further
   * chaining.
   *
   * This is the extension point for adding post-build behaviour to a
   * composed system without modifying the system itself. Domain-specific
   * packages provide helper functions that return hooks — for example,
   * `outputs()` from `@composurecdk/cloudformation` creates CfnOutput
   * constructs.
   *
   * @param hook - A callback invoked after all components are built.
   * @returns A {@link ConfiguredSystem} with the hook applied.
   *
   * @example
   * ```ts
   * compose({ site, cdn }, { site: [], cdn: ["site"] })
   *   .afterBuild(outputs({
   *     Url: { value: ref("cdn", r => r.distribution.domainName) },
   *   }))
   *   .build(stack, "MySystem");
   * ```
   */
  afterBuild(hook: AfterBuildHook<BuildResult<Components>>): ConfiguredSystem<Components>;
}

/**
 * A {@link Lifecycle} with stack routing or post-build hooks applied.
 * Returned by {@link ComposedSystem.withStacks},
 * {@link ComposedSystem.withStackStrategy}, and
 * {@link ComposedSystem.afterBuild}.
 *
 * Supports chaining further {@link afterBuild} hooks. Stack routing methods
 * are not available — they are mutually exclusive and must be chosen on
 * the original {@link ComposedSystem}.
 */
export interface ConfiguredSystem<Components extends Record<string, Lifecycle>> extends Lifecycle<
  BuildResult<Components>
> {
  /**
   * Appends a post-build hook. Multiple hooks can be chained; they execute
   * in registration order after all components have been built.
   *
   * @param hook - A callback invoked after all components are built.
   * @returns This {@link ConfiguredSystem} for further chaining.
   */
  afterBuild(hook: AfterBuildHook<BuildResult<Components>>): ConfiguredSystem<Components>;
}

/**
 * A composed system of {@link Lifecycle} components. Holds the dependency graph
 * built at composition time and traverses it in topological order during build.
 */
class ComposedLifecycle<
  Components extends Record<string, Lifecycle>,
> implements ComposedSystem<Components> {
  readonly #graph: Graph;
  readonly #components: Components;
  readonly #dependencies: { [Property in keyof Components]: Dependency<Components> };

  constructor(
    components: Components,
    dependencies: { [Property in keyof Components]: Dependency<Components> },
  ) {
    this.#components = components;
    this.#dependencies = dependencies;
    this.#graph = buildDependencyGraph(components, dependencies);
  }

  withStacks(stacks: { [K in keyof Components]?: IConstruct }): ConfiguredSystem<Components> {
    return new ConfiguredLifecycle((scope, id, parentContext) =>
      this.#buildWith(scope, id, stacks, parentContext),
    );
  }

  withStackStrategy(strategy: StackStrategy): ConfiguredSystem<Components> {
    return new ConfiguredLifecycle((scope, id, parentContext) => {
      const stacks = Object.fromEntries(
        Object.keys(this.#components).map((key) => [key, strategy.resolve(scope, id, key)]),
      ) as { [K in keyof Components]?: IConstruct };
      return this.#buildWith(scope, id, stacks, parentContext);
    });
  }

  afterBuild(hook: AfterBuildHook<BuildResult<Components>>): ConfiguredSystem<Components> {
    return new ConfiguredLifecycle<Components>((scope, id, parentContext) =>
      this.#buildWith(scope, id, undefined, parentContext),
    ).afterBuild(hook);
  }

  build(
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ): BuildResult<Components> {
    return this.#buildWith(scope, id, undefined, parentContext).results;
  }

  #buildWith(
    scope: IConstruct,
    id: string,
    stacks?: { [K in keyof Components]?: IConstruct },
    parentContext?: Record<string, object>,
  ): BuildOutcome<Components> {
    const results: Record<string, object> = {};
    const componentScopes: Record<string, IConstruct> = {};

    for (const key of alg.topsort(this.#graph)) {
      const componentScope = stacks?.[key] ?? scope;
      componentScopes[key] = componentScope;
      const deps = (this.#dependencies[key] ?? []) as string[];
      // Merge parent context (outer siblings visible when this system is nested)
      // with inner dependency outputs. Inner deps shadow on key collision —
      // local bindings take precedence over the enclosing scope.
      const innerContext = Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
      const context = { ...parentContext, ...innerContext };
      results[key] = this.#components[key].build(componentScope, `${id}/${key}`, context);
    }

    return {
      results: results as BuildResult<Components>,
      componentScopes: componentScopes as { [K in keyof Components]: IConstruct },
    };
  }
}

interface BuildOutcome<Components extends Record<string, Lifecycle>> {
  readonly results: BuildResult<Components>;
  readonly componentScopes: { readonly [K in keyof Components]: IConstruct };
}

/**
 * A configured lifecycle that accumulates post-build hooks and applies them
 * after the underlying build function completes. Returned by
 * {@link ComposedLifecycle}'s `withStacks`, `withStackStrategy`, and
 * `afterBuild` methods.
 */
class ConfiguredLifecycle<
  Components extends Record<string, Lifecycle>,
> implements ConfiguredSystem<Components> {
  readonly #hooks: AfterBuildHook<BuildResult<Components>>[] = [];
  readonly #buildFn: (
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ) => BuildOutcome<Components>;

  constructor(
    buildFn: (
      scope: IConstruct,
      id: string,
      parentContext?: Record<string, object>,
    ) => BuildOutcome<Components>,
  ) {
    this.#buildFn = buildFn;
  }

  afterBuild(hook: AfterBuildHook<BuildResult<Components>>): ConfiguredSystem<Components> {
    this.#hooks.push(hook);
    return this;
  }

  build(
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ): BuildResult<Components> {
    const { results, componentScopes } = this.#buildFn(scope, id, parentContext);
    for (const hook of this.#hooks) {
      hook(scope, id, results, componentScopes);
    }
    return results;
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
