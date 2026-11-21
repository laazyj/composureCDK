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

### Encapsulating a system: `scoped`

By default a nested system's components build beside their parent's, as `App--failures--bucket`. `scoped(system)` builds the system under a construct of its own instead, with each component at its key. Use it in a composite builder so everything the composite creates sits under one node:

```ts
import { type IConstruct } from "constructs";
import { compose, scoped, type Lifecycle } from "@composurecdk/core";

class FailureCaptureBuilder implements Lifecycle<FailureCaptureResult> {
  build(scope: IConstruct, id: string, context?: Record<string, object>) {
    return scoped(compose({ bucket, queue, rule }, deps)).build(scope, id, context);
  }
}
// App--failures/bucket, App--failures/queue, App--failures/rule
```

The new construct is a target for `Tags.of()` and Aspects that reaches only the system. Hooks added with `afterBuild` on the wrapped system get it as their scope, so `tags()` there tags the system's resources alone. `at()` pins still win over keys, and a component routed to another stack keeps its prefixed id.

Wrapping a system that is already deployed changes its construct paths, which replaces its resources. See [ADR-0020](../../docs/adr/0020-scoped-system-construct.md).

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

## Ordering: `addDependencies`

`compose()` decides the order components _build_; CloudFormation decides the order resources _deploy_, and it only orders B after A when B's template references A. Where no such reference exists — an SDK call whose parameters are hardcoded strings, a Lambda invoked during deployment — the edge has to be declared.

`addDependencies(target, sources, context)` is that seam. Each source is a concrete construct, a `ref` to one construct inside a sibling's result, or a `ref` to the whole sibling:

```ts
import { addDependencies, ref } from "@composurecdk/core";

addDependencies(
  trigger,
  [
    queue, // a construct you already hold
    ref("api", (r: RestApiBuilderResult) => r.api), // one construct out of a sibling
    ref<SeedBuilderResult>("seed"), // every construct that sibling built
  ],
  context,
);
```

A construct-level dependency already covers that construct's own children, so naming one is enough whenever what you need sits under it — ordering against a `RestApi` also orders against its deployment and stage. Naming the component instead also reaches its _peers_: an API's access log group, a queue's dead-letter queue.

It backs `dependsOn` in [`@composurecdk/custom-resources`](../custom-resources/README.md) and `after` in [`@composurecdk/lambda`](../lambda/README.md)'s `.invokeOnDeploy()`, so both spell ordering the same way.

### Ordering a component: `deployAfter`

In a composed system you don't need to call `addDependencies` yourself. Wrap the component in `deployAfter(sources, component, target)` instead, and the edge is declared beside the component it orders. `target` selects the construct that gets the edge:

```ts
import { compose, deployAfter, ref } from "@composurecdk/core";

compose(
  {
    zone: createHostedZoneBuilder().zoneName("app.example.com"),
    delegation: createCrossAccountZoneDelegationBuilder()
      .delegatedZone(ref("zone", zoneOf))
      .parentHostedZoneName("example.com")
      .delegationRole(delegationRoleArn),
    // ACM can only validate once the parent zone delegates to `zone`, but
    // nothing in the certificate's template references the NS record.
    certificate: deployAfter(
      [ref("delegation", (r: CrossAccountZoneDelegationBuilderResult) => r.record)],
      createCertificateBuilder().domainName("app.example.com").validationZone(ref("zone", zoneOf)),
      (r) => r.certificate,
    ),
  },
  { zone: [], delegation: ["zone"], certificate: ["zone", "delegation"] },
);
```

`target` is required, and the sibling must still be a declared dependency, since refs in `sources` resolve against the build context. See [ADR-0021](../../docs/adr/0021-deploy-order-is-a-composition-concern.md).

## Examples

- [MultiStackApp](../examples/src/multi-stack-app.ts) — System composed with `withStacks` for multi-stack routing, demonstrates cross-component wiring with `ref`
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — S3 + CloudFront composed system with `ref` and `afterBuild`
- [DynamoStreamProcessorStack](../examples/src/dynamo-stream-processor-app.ts) — Stream consumer and its DLQ built under one construct with `scoped`, tagged as a unit
