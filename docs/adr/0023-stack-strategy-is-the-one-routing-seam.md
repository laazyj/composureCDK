# ADR 0023: A stack strategy is the one way to route components to stacks

- **Status:** Proposed
- **Date:** 2026-11-23

## Context

A composed system routes its components to stacks in one of two ways, described in [Stack management](../stack-management.md#approaches): a `withStacks` map of stacks the app has built, or a `withStackStrategy`. Neither meets what laazyj/composureCDK#855 needs:

1. stack settings for each group, at least `env`;
2. the mapping checked against the component keys, so a missing or renamed subsystem fails rather than building in the `App`;
3. a handle on each stack before build, for removal policies, Aspects and `addDependency`; and
4. stacks built by a deployment framework's own `Stack` subclass.

Where they fall short:

- **`withStacks`:** the map is partial. A key left out builds in the scope passed to `build()`, without an error.
- **`StackStrategy`:** it was meant to be the extensible seam, but its `resolve(scope, systemId, componentKey: string)` sees one key at a time. It cannot reject a key it has no stack for, or one that is not a component, and its type knows nothing of the system.
- **The built-in strategies:**
  - They create their stacks lazily, so the app has no handle before build.
  - `groupedStacks` builds every group from one builder, so groups cannot differ in `env`.
  - Both strategies exist twice, in `core` and in `cloudformation`.

The app behind #855 also adds one component per environment by spreading keys in (`{ rootZone, ...Object.fromEntries(envs.map(…)) }`). TypeScript types that object as `{ rootZone }`, so only a check made when components are placed can catch a missing environment.

## Decision

**A `StackStrategy` is the one way a composed system routes components to stacks. Every build goes through one. It sees every component key at once and is typed by them, and `compose()` checks its answer.**

```ts
interface StackStrategy<K extends string = string> {
  readonly place: (
    scope: IConstruct,
    systemId: string,
    keys: readonly K[],
  ) => { readonly [P in K]: IConstruct };
}

withStackStrategy(strategy: StackStrategy<keyof Components & string>): ConfiguredSystem<Components>;
```

### The strategy

- **`place` sees every key, once per build.** A strategy can therefore create each stack once, and name every key it cannot place in one error.
- **`place` is a property, not a method,** so its parameter is checked contravariantly. A strategy for any key (`StackStrategy<string>`) fits every system. A strategy typed by fewer keys than the system has fails to compile.
- **`compose()` checks the answer.** It throws a `StackPlacementError` that lists every component with no scope (or `undefined`) and every key that is not a component. This one check covers keys a type cannot see, maps that are built or cast, and hand-written strategies. Like `CyclicDependencyError` and `DuplicateConstructIdError`, it is exported and caught by `name` ([Errors](../architecture.md#errors)), so an app's tests can expect it.
- **No silent fallback.** `#buildWith` takes a complete placement, so the `?? scope` path goes. A system with no strategy uses the default.

### Stack sources

A stack source is one of three things:

- a stack the app has built (any `IConstruct`), which gives it a handle before build;
- a `Lifecycle<{ stack: IConstruct }>` that builds one, such as `createStackBuilder()` or a framework's own builder;
- `BUILD_SCOPE`, the scope passed to `build()`.

`core` distinguishes them at run time, and still depends only on `constructs`.

### Two built-in strategies, both in `core`

- **`singleStack(source)`:** every component on one stack. **The default strategy is `singleStack(BUILD_SCOPE)`**, which is what a system with no routing does today, so `compose(…).build(stack, id)` is unchanged.
- **`groupedStacks(groups, placement)`:** each component on its group's stack. `groups` maps each group to a stack source. `placement` maps every component key to a group, and is typed by both, so a key that is missing, or placed in a group that doesn't exist, fails to compile. When the type cannot see it, the key is left unplaced and reported by `compose()`'s check. Only groups that some component is placed in are built.

  ```ts
  groupedStacks(
    {
      core: createStackBuilder().env(coreEnv),
      viewer: viewerStack, // built by the app, which needs it for addDependency
    },
    { ingestEdge: "core", dataPlane: "core", viewer: "viewer" },
  );
  ```

**`withStacks(map)` is a named shortcut:** `groupedStacks` with each key as its own group. Its values are stack sources, so `BUILD_SCOPE` keeps a component in the scope passed to `build()`. An `undefined` value leaves the component unplaced, for `compose()`'s check to report, so a failed lookup such as `stacks[env]` cannot fall back silently.

### Stack ids

A group's builder is built once:

- **with an `at(id, builder)` pin,** under that id, as for components ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md));
- **otherwise,** under `` `${systemId}-${group}` ``, as today. Renaming a group then renames its stack.

The README explains how to keep a deployed stack through a rename. Only `core` can read an `at()` pin, and an `at()`-pinned builder throws when it is built under another id, which is one reason the strategies move into `core`. `.copy()` remains the way to snapshot a builder before handing it to a strategy ([ADR-0005](0005-builder-copy.md)).

### Options not taken

- **A third method that requires every key** (laazyj/composureCDK#876, closed unmerged). It would have left three ways to route components.
- **Make `withStacks` require every key, and leave `StackStrategy` as it is.** That leaves two mechanisms, and a seam that still cannot see the system.
- **Only `withStackStrategy`, with no `withStacks`.** The commonest case gets wordier for no gain.
- **A placement function in place of a map.** It would be typed by the static keys only, so it still needs the run-time check. A map built from `envs` already serves systems whose keys are spread in.
- **Create every group's stack when the strategy is bound to an `App`, and expose them.** That is building the stacks under another name. A built stack as the group's source already provides the handle.

## Consequences

- **#855's needs are met** by `groupedStacks`, or by `withStacks` over stacks the app has built.
- **One mechanism, two strategies.** `withStacks` is a shortcut, not a second mechanism. Routing is otherwise unchanged, including how routed components are named under `scoped()` ([ADR-0020](0020-scoped-system-construct.md)).
- **`core` exports `StackPlacementError`,** alongside its other composition errors.
- **Breaking changes in `core`:**
  - a custom strategy moves from `resolve` to `place`;
  - a `withStacks` map lists every key, marking any that stay in the build scope with `BUILD_SCOPE`;
  - `ScopeFactory` becomes a `Lifecycle`;
  - `groupedStacks(classify, …)` becomes `groupedStacks(groups, placement)`.
- **In `cloudformation`:** `singleStack` and `groupedStacks` are deprecated for one minor release, then removed. `createStackBuilder()` is already a stack source.
- **[Stack management](../stack-management.md) teaches one decision:** build into a stack, then `withStacks`, then `singleStack` or `groupedStacks`, then a strategy of your own.
