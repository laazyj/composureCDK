# @composurecdk/core

Core primitives for [ComposureCDK](../../README.md).

This package provides the foundational types and utilities that all ComposureCDK resource packages build on: the fluent `Builder` proxy, the `compose` function for assembling component systems with dependency resolution, lazy `Ref` cross-references, and stack strategies for routing components to scopes.

Most users interact with these primitives indirectly through resource packages (e.g., `@composurecdk/lambda`, `@composurecdk/s3`). Use this package directly when building a custom ComposureCDK resource package or when composing systems.

## Builder

Generic fluent-builder factory that wraps a class, exposing every property in `Props` as an overloaded getter/setter method. Resource packages use this internally to create their builders.

```ts
import { Builder, type IBuilder } from "@composurecdk/core";

type IMyBuilder = IBuilder<MyProps, MyLifecycle>;

export function createMyBuilder(): IMyBuilder {
  return Builder<MyProps, MyLifecycle>(MyLifecycle);
}
```

## compose

Composes a set of `Lifecycle` components into a single system with automatic dependency resolution. Dependencies are declared as data; the system builds components in topological order and passes resolved outputs as context.

```ts
import { compose } from "@composurecdk/core";

const system = compose(
  { handler: createFunctionBuilder(), api: createRestApiBuilder() },
  { handler: [], api: ["handler"] },
);

system.build(stack, "MySystem");
```

Cyclic dependencies are detected at composition time and throw a `CyclicDependencyError`.

### Stack routing

Route components to different scopes (typically Stacks) using `withStacks` or `withStackStrategy`:

```ts
// Explicit scope mapping
system.withStacks({ handler: serviceStack, api: apiStack }).build(app, "MySystem");

// Strategy-based routing
import { singleStack, groupedStacks } from "@composurecdk/core";

system.withStackStrategy(singleStack(myFactory)).build(app, "MySystem");

system
  .withStackStrategy(groupedStacks((key) => (key === "handler" ? "compute" : "api"), myFactory))
  .build(app, "MySystem");
```

### Post-build hooks

Register callbacks that run after all components are built via `afterBuild`. Domain-specific packages provide helper functions that return hooks — for example, `outputs()` from `@composurecdk/cloudformation`.

```ts
system
  .afterBuild((scope, id, results) => {
    console.log("Built:", Object.keys(results));
  })
  .build(stack, "MySystem");
```

## Ref

Lazy cross-component references that are resolved at build time. Use `ref` to reference a dependency's output at configuration time — the value is resolved when the system is built.

```ts
import { ref } from "@composurecdk/core";
import type { FunctionBuilderResult } from "@composurecdk/lambda";

// Reference the full build result
ref<FunctionBuilderResult>("handler");

// Narrow to a specific property
ref<FunctionBuilderResult>("handler").get("function");

// Transform the referenced value
ref<FunctionBuilderResult>("handler")
  .get("function")
  .map((fn) => new LambdaIntegration(fn));

// Shorthand with inline transform
ref<FunctionBuilderResult>("handler", (r) => new LambdaIntegration(r.function));
```

## Examples

- [MultiStackApp](../examples/src/multi-stack-app.ts) — System composed with `withStacks` for multi-stack routing, demonstrates cross-component wiring with `ref`
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — S3 + CloudFront composed system with `ref` and `afterBuild`
