import { Construct, type IConstruct } from "constructs";
import { buildIdOf } from "./build-id.js";
import { type Lifecycle } from "./lifecycle.js";

/**
 * A {@link StackSource} meaning the scope passed to `build()`.
 *
 * `singleStack(BUILD_SCOPE)` is what a system with no stack routing does. In a
 * `withStacks` map or a `groupedStacks` group, it keeps a component in the
 * scope the system is built into while others go elsewhere.
 *
 * Registered with `Symbol.for`, so the ESM and CommonJS copies of
 * `@composurecdk/core` recognise each other's (ADR-0007).
 */
export const BUILD_SCOPE: unique symbol = Symbol.for("composurecdk.buildScope");

/**
 * Where a strategy gets a stack (or any scope) from:
 *
 * - a stack the app has already built, which gives the app a handle on it
 *   before the system builds;
 * - a {@link Lifecycle} that builds one, such as `createStackBuilder()` from
 *   `@composurecdk/cloudformation` or a deployment framework's own builder.
 *   It is built under its `at()` pin if it has one, otherwise under an id the
 *   strategy derives;
 * - {@link BUILD_SCOPE}, the scope passed to `build()`.
 */
export type StackSource =
  IConstruct | Lifecycle<{ readonly stack: IConstruct }> | typeof BUILD_SCOPE;

/**
 * Decides which scope (typically a Stack) each component of a composed system
 * is built in. Every build of a system goes through one; with none set, every
 * component builds in the scope passed to `build()`.
 *
 * `place` is called once per build with every component key, and returns the
 * scope for each. `compose()` checks the answer, and throws if any component
 * has no scope or the answer names a key that is not a component, with a
 * `StackPlacementError`.
 *
 * `place` is a property rather than a method so that its parameter is checked
 * contravariantly: a strategy for any key (`StackStrategy<string>`) fits every
 * system, and one typed by fewer keys than the system has fails to compile.
 *
 * @typeParam K - The component keys the strategy can place.
 *
 * @example
 * ```ts
 * // Every component on its stage's stack, chosen by a naming rule
 * const byStage: StackStrategy = {
 *   place: (scope, systemId, keys) =>
 *     Object.fromEntries(keys.map((key) => [key, stageStacks[stageOf(key)]])),
 * };
 * ```
 */
export interface StackStrategy<K extends string = string> {
  /**
   * Returns the scope each component should be built in.
   *
   * @param scope - The scope passed to `build`.
   * @param systemId - The id passed to `build`.
   * @param keys - Every component key in the system.
   * @returns The scope for every key.
   */
  readonly place: (
    scope: IConstruct,
    systemId: string,
    keys: readonly K[],
  ) => Readonly<Record<K, IConstruct>>;
}

/**
 * Creates a strategy that builds every component on one stack.
 *
 * @param source - The stack. A {@link Lifecycle} source is built once per
 *   build of the system, under its `at()` pin or else the system's id.
 * @returns A {@link StackStrategy} for any system.
 *
 * @example
 * ```ts
 * compose({ handler, api }, { handler: [], api: ["handler"] })
 *   .withStackStrategy(singleStack(createStackBuilder().description("Service")))
 *   .build(app, "MySystem");
 * ```
 * @see {@link https://github.com/laazyj/composureCDK/blob/main/packages/core/docs/agent-rules.md | Agent rules (LAYER-9)}
 */
export function singleStack(source: StackSource): StackStrategy {
  return {
    place: (scope, systemId, keys) => {
      const stack = resolveSource(source, scope, systemId);
      return Object.fromEntries(keys.map((key) => [key, stack]));
    },
  };
}

/**
 * Creates a strategy that builds each component on its group's stack.
 *
 * `placement` maps every component key to a group, and is typed by the groups,
 * so a key that is missing or placed in a group that does not exist fails to
 * compile. Keys the type cannot see, such as ones spread in from
 * `Object.fromEntries`, are left unplaced and reported by `compose()` when it
 * builds. A placed key that is not a component, such as the old name left
 * behind by a rename, also compiles, since the keys are inferred from
 * `placement`; `compose()` reports it too.
 *
 * Only groups that some component is placed in are built. A {@link Lifecycle}
 * source is built under its `at()` pin, or else `` `${systemId}-${group}` ``,
 * so renaming a group renames its stack unless the builder is pinned.
 *
 * @param groups - The stack source for each group.
 * @param placement - The group for each component key.
 * @returns A {@link StackStrategy} for the keys in `placement`.
 *
 * @example
 * ```ts
 * compose({ ingestEdge, dataPlane, viewer }, { ... })
 *   .withStackStrategy(
 *     groupedStacks(
 *       {
 *         core: createStackBuilder().env(coreEnv),
 *         viewer: viewerStack, // built by the app, which holds it for addDependency
 *       },
 *       { ingestEdge: "core", dataPlane: "core", viewer: "viewer" },
 *     ),
 *   )
 *   .build(app, "FactoryForeman");
 * ```
 * @see {@link https://github.com/laazyj/composureCDK/blob/main/packages/core/docs/agent-rules.md | Agent rules (LAYER-9)}
 */
export function groupedStacks<G extends string, K extends string>(
  groups: Readonly<Record<G, StackSource>>,
  placement: Readonly<Record<K, NoInfer<G>>>,
): StackStrategy<K> {
  return {
    // Places the keys in `placement`, not `keys`, and leaves a key unplaced
    // when its group has no source: compose() then reports every problem in
    // one StackPlacementError.
    place: (scope, systemId) => {
      const stacks = new Map<G, IConstruct>();
      const result: Partial<Record<K, IConstruct>> = {};
      for (const [key, group] of Object.entries(placement) as [K, G | undefined][]) {
        if (group === undefined) continue;
        let stack = stacks.get(group);
        if (!stack) {
          const source = Object.hasOwn(groups, group) ? groups[group] : undefined;
          if (source === undefined) continue;
          stack = resolveSource(source, scope, `${systemId}-${group}`);
          stacks.set(group, stack);
        }
        result[key] = stack;
      }
      return result as Readonly<Record<K, IConstruct>>;
    },
  };
}

/** Returns the scope a {@link StackSource} stands for, building it if needed. */
function resolveSource(source: StackSource, scope: IConstruct, id: string): IConstruct {
  if (source === BUILD_SCOPE) return scope;
  if (isLifecycle(source)) {
    // The stack is the container components are built into, so it is built
    // before any component context exists.
    // eslint-disable-next-line composurecdk/lifecycle-build-must-forward-context -- root build: no enclosing component context exists
    return source.build(scope, buildIdOf(source) ?? id).stack;
  }
  return source;
}

function isLifecycle(
  source: Exclude<StackSource, typeof BUILD_SCOPE>,
): source is Lifecycle<{ readonly stack: IConstruct }> {
  return (
    !Construct.isConstruct(source) && typeof (source as Partial<Lifecycle>).build === "function"
  );
}
