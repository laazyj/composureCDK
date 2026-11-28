import { Graph, alg, json } from "@dagrejs/graphlib";
import { type IConstruct } from "constructs";
import { buildIdOf, SCOPED_BUILD } from "./build-id.js";
import { CyclicDependencyError } from "./cyclic-dependency-error.js";
import { DuplicateConstructIdError } from "./duplicate-construct-id-error.js";
import { type Lifecycle } from "./lifecycle.js";
import { StackPlacementError } from "./stack-placement-error.js";
import {
  BUILD_SCOPE,
  groupedStacks,
  singleStack,
  type StackSource,
  type StackStrategy,
} from "./stack-strategy.js";

/** With no strategy set, every component builds in the scope passed to `build`. */
const DEFAULT_STRATEGY = singleStack(BUILD_SCOPE);

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
   * Returns a new {@link ConfiguredSystem} that builds each component on the
   * stack the map gives for it. A shortcut for {@link withStackStrategy} with
   * `groupedStacks`, each key its own group.
   *
   * Every component key is required, and the map is checked when the system
   * builds, as for {@link withStackStrategy}. Each value is a
   * {@link StackSource}: a stack you have built (any `IConstruct`, so `Stack`
   * subclasses work), a `Lifecycle` that builds one, or `BUILD_SCOPE` to keep
   * the component in the scope passed to `build`. One builder given to two
   * keys builds two stacks; to share one, pass a built stack or use
   * `groupedStacks`.
   *
   * @param stacks - The stack source for each component key.
   * @returns A {@link ConfiguredSystem} with stack routing applied.
   *
   * @example
   * ```ts
   * compose({ handler, api }, { handler: [], api: ["handler"] })
   *   .withStacks({ handler: serviceStack, api: apiStack })
   *   .build(app, "MySystem");
   * ```
   */
  withStacks(stacks: {
    readonly [K in keyof Components]: StackSource;
  }): ConfiguredSystem<Components>;

  /**
   * Returns a new {@link ConfiguredSystem} that uses a {@link StackStrategy}
   * to determine each component's scope during build. The returned system
   * supports further chaining of {@link ConfiguredSystem.afterBuild | .afterBuild()} hooks.
   *
   * The strategy is typed by the system's keys, so one that places fewer keys
   * than the system has fails to compile. Its answer is also checked when the
   * system builds, which catches keys the type cannot see.
   *
   * @throws {@link StackPlacementError} when the system builds, if a component
   *   has no scope or the strategy places a key that is not a component.
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
   *     { service: serviceStack, persistence: createStackBuilder() },
   *     { handler: "service", api: "service", table: "persistence" },
   *   ))
   *   .afterBuild(outputs({ ... }))
   *   .build(app, "MySystem");
   * ```
   */
  withStackStrategy(
    strategy: StackStrategy<keyof Components & string>,
  ): ConfiguredSystem<Components>;

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
  readonly #keys: readonly (keyof Components & string)[];

  constructor(
    components: Components,
    dependencies: { [Property in keyof Components]: Dependency<Components> },
  ) {
    this.#components = components;
    this.#dependencies = dependencies;
    this.#graph = buildDependencyGraph(components, dependencies);
    this.#keys = Object.keys(components);
  }

  withStacks(stacks: {
    readonly [K in keyof Components]: StackSource;
  }): ConfiguredSystem<Components> {
    const eachKeyItsOwnGroup = Object.fromEntries(Object.keys(stacks).map((key) => [key, key]));
    return this.withStackStrategy(groupedStacks(stacks, eachKeyItsOwnGroup));
  }

  withStackStrategy(
    strategy: StackStrategy<keyof Components & string>,
  ): ConfiguredSystem<Components> {
    return new ConfiguredLifecycle((scope, id, parentContext, keyed) =>
      this.#buildWith(scope, id, strategy, parentContext, keyed),
    );
  }

  afterBuild(hook: AfterBuildHook<BuildResult<Components>>): ConfiguredSystem<Components> {
    return new ConfiguredLifecycle<Components>((scope, id, parentContext, keyed) =>
      this.#buildWith(scope, id, DEFAULT_STRATEGY, parentContext, keyed),
    ).afterBuild(hook);
  }

  build(
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ): BuildResult<Components> {
    return this.#buildWith(scope, id, DEFAULT_STRATEGY, parentContext, false).results;
  }

  /** @internal Builds with key-only ids; see {@link scoped}. */
  [SCOPED_BUILD](
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ): BuildResult<Components> {
    return this.#buildWith(scope, id, DEFAULT_STRATEGY, parentContext, true).results;
  }

  /** Asks the strategy for every component's scope, and checks its answer. */
  #place(
    strategy: StackStrategy<keyof Components & string>,
    scope: IConstruct,
    id: string,
  ): Readonly<Record<string, IConstruct>> {
    const placement: Partial<Record<string, IConstruct>> = strategy.place(scope, id, this.#keys);
    const unplaced = this.#keys.filter((key) => placement[key] === undefined);
    const unknown = Object.keys(placement).filter((key) => !Object.hasOwn(this.#components, key));
    if (unplaced.length > 0 || unknown.length > 0) {
      throw new StackPlacementError(id, unplaced, unknown);
    }
    return placement as Readonly<Record<string, IConstruct>>;
  }

  /**
   * @param keyed - Derive a component's id from its key alone when it builds
   *   into `scope`, which {@link scoped} has created for this system. A
   *   component routed to another scope keeps the prefixed id, since `scope`
   *   does not namespace it there.
   */
  #buildWith(
    scope: IConstruct,
    id: string,
    strategy: StackStrategy<keyof Components & string>,
    parentContext: Record<string, object> | undefined,
    keyed: boolean,
  ): BuildOutcome<Components> {
    const placement = this.#place(strategy, scope, id);
    const results: Record<string, object> = {};
    const componentScopes: Record<string, IConstruct> = {};
    // Tracks the construct ids built into each scope so an explicit id from
    // at() that collides with a sibling fails loudly here, rather than as an
    // opaque CDK duplicate-construct error deeper in synth.
    const idsByScope = new Map<IConstruct, Set<string>>();

    for (const key of alg.topsort(this.#graph)) {
      const componentScope = placement[key];
      componentScopes[key] = componentScope;
      const deps = (this.#dependencies[key] ?? []) as string[];
      // Inner deps shadow parent context on key collision.
      const innerContext = Object.fromEntries(deps.map((dep) => [dep, results[dep]]));
      const context = { ...parentContext, ...innerContext };
      const component = this.#components[key];
      // An at()-tagged component pins its own id; otherwise derive it from the key.
      const componentId =
        buildIdOf(component) ?? (keyed && componentScope === scope ? key : `${id}/${key}`);

      let usedIds = idsByScope.get(componentScope);
      if (!usedIds) idsByScope.set(componentScope, (usedIds = new Set<string>()));
      if (usedIds.has(componentId)) {
        throw new DuplicateConstructIdError(componentId, key);
      }
      usedIds.add(componentId);

      results[key] = component.build(componentScope, componentId, context);
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

type BuildFn<Components extends Record<string, Lifecycle>> = (
  scope: IConstruct,
  id: string,
  parentContext: Record<string, object> | undefined,
  keyed: boolean,
) => BuildOutcome<Components>;

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
  readonly #buildFn: BuildFn<Components>;

  constructor(buildFn: BuildFn<Components>) {
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
    return this.#build(scope, id, parentContext, false);
  }

  /** @internal Builds with key-only ids; see {@link scoped}. */
  [SCOPED_BUILD](
    scope: IConstruct,
    id: string,
    parentContext?: Record<string, object>,
  ): BuildResult<Components> {
    return this.#build(scope, id, parentContext, true);
  }

  #build(
    scope: IConstruct,
    id: string,
    parentContext: Record<string, object> | undefined,
    keyed: boolean,
  ): BuildResult<Components> {
    const { results, componentScopes } = this.#buildFn(scope, id, parentContext, keyed);
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
 * receiving the build outputs of its dependencies as its context. Components
 * with no dependency path between them have no defined order relative to each
 * other, so a component that must build after another declares that dependency.
 *
 * The returned {@link ComposedSystem} is a {@link Lifecycle}, so it can be
 * nested as a component in a larger `compose` call.
 *
 * @param components - A record of named {@link Lifecycle} components.
 * @param dependencies - For each component, the list of other component keys it depends on.
 * @returns A {@link ComposedSystem} whose build output is the combined {@link BuildResult} of all components.
 * @see {@link https://github.com/laazyj/composureCDK/blob/main/docs/architecture.md#compose | Architecture: compose}
 * @see {@link https://github.com/laazyj/composureCDK/blob/main/packages/core/docs/agent-rules.md | Agent rules (DECL-1 to DECL-12)}
 */
export function compose<Components extends Record<string, Lifecycle>>(
  components: Components,
  dependencies: { [Property in keyof Components]: Dependency<Components> },
): ComposedSystem<Components> {
  return new ComposedLifecycle(components, dependencies);
}
