# ADR 0024: A stack source can be a stack another component builds

- **Status:** Proposed
- **Date:** 2026-11-24

## Context

[ADR-0023](0023-stack-strategy-is-the-one-routing-seam.md) routes every component through a `StackStrategy`, whose `place` answers before any component builds ([stack sources](../stack-management.md#3-stack-map-withstacks)).

Some stacks can't exist that early. A deployment-pipeline framework may supply its own `Stack` subclass whose environment comes from a pipeline construct, such as `pipeline.deploymentEnvironmentFor(account, region)`. That stack can only be built after the pipeline component has been built (laazyj/composureCDK#884). Today the app splits one architecture across two `compose()` calls: it builds the pipeline, then the stacks, then the rest, and joins them by hand. No declaration shows the dependency.

A `Ref` is an opaque closure, so `compose()` can't see which component a source refers to, and every edge is declared in the dependency record ([architecture](../architecture.md#dependency-declarations-are-exhaustive)).

## Decision

**A stack that depends on a component is built by a component of its own. A stack source can be a `Ref<IConstruct>` to that component's stack, and `compose()` resolves it against each placed component's context, just before that component builds.**

```ts
compose(
  {
    pipeline,
    prodStack: createDeploymentStackBuilder().env(ref("pipeline", envFor(prod))),
    ingestEdge,
  },
  { pipeline: [], prodStack: ["pipeline"], ingestEdge: ["prodStack"] },
)
  .withStackStrategy(
    groupedStacks(
      { app: BUILD_SCOPE, prod: ref<{ stack: Stack }>("prodStack").get("stack") },
      { pipeline: "app", prodStack: "app", ingestEdge: "prod" },
    ),
  )
  .build(app, "Factory");
```

- **A stack source, and a strategy's answer, may be a `Resolvable<IConstruct>`.** This is the library's usual pattern for an input that may come from a sibling, applied to placement. `singleStack` and `groupedStacks` pass a ref through unbuilt, and `compose()` still checks the answer for every key.
- **Edges are declared.** A component placed on such a stack lists the stack's component in its dependency record, as it would for any other input. The existing graph then orders the build, and a forgotten edge fails when the ref resolves.
- **Cycles fail at composition.** Placing a component on a stack whose component depends on it is a cycle in the record, which `compose()` already rejects.
- **The stack component is an ordinary component:** any `Lifecycle<{ stack }>`, named, placed and hooked like any other ([ADR-0012](0012-explicit-build-id-decoupled-from-compose-key.md)).

### Options not taken

- **Infer the edges from the refs.** `Ref` would have to carry its target key, a wider change, and it would be the first edge the library infers rather than declares.
- **A strategy that declares its own dependencies alongside `place`.** That is a second place where edges are declared, beside the dependency record.
- **Make `createStackBuilder()` resolve `Resolvable` props.** A framework's own builder, or an inline `Lifecycle`, covers the case.

## Consequences

- **One declaration again.** The pipeline and the stacks it deploys are one `compose()`, with the dependency visible in it.
- **No handle before build** on a stack a component builds. Removal policies, Aspects and stack dependencies on it go in an `afterBuild` hook or in its builder. Stacks from other sources keep their handle.
- **Components placed on such a stack declare its key.** Usually only top-level subsystems are placed, so that is a few entries.
- **The answer type of `StackStrategy` widens.** Strategies that return constructs are unchanged. Code that reads an answer outside `compose()` must handle a `Ref`, which makes this a breaking change.
