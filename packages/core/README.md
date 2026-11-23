# @composurecdk/core

Core primitives for [ComposureCDK](https://github.com/laazyj/composureCDK/blob/main/README.md).

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

Every build of a system goes through a `StackStrategy`, which decides the scope (typically a Stack) each component builds in. With none set, every component builds in the scope passed to `build()`.

```ts
import { BUILD_SCOPE, groupedStacks, singleStack } from "@composurecdk/core";

// A stack for each component; every key is required
system.withStacks({ handler: serviceStack, api: apiStack }).build(app, "MySystem");

// Keep one component in the scope passed to build()
system.withStacks({ handler: BUILD_SCOPE, api: apiStack }).build(serviceStack, "MySystem");

// Every component on one stack
system.withStackStrategy(singleStack(createStackBuilder())).build(app, "MySystem");

// Components grouped onto stacks, typed by group and by key
system
  .withStackStrategy(
    groupedStacks(
      { compute: createStackBuilder().env(euWest2), api: apiStack },
      { handler: "compute", api: "api" },
    ),
  )
  .build(app, "MySystem");
```

Each of these takes a **stack source**: a stack you have built, a `Lifecycle` that builds one, or `BUILD_SCOPE`. `withStacks(map)` is `groupedStacks` with each key its own group. A wrong placement, including keys the type cannot see, throws a `StackPlacementError` when the system builds. To write your own strategy, implement `StackStrategy`'s `place(scope, systemId, keys)`. See [Stack management](https://github.com/laazyj/composureCDK/blob/main/docs/stack-management.md) and [ADR-0023](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0023-stack-strategy-is-the-one-routing-seam.md).

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

Wrapping a system that is already deployed changes its construct paths, which replaces its resources. See [ADR-0020](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0020-scoped-system-construct.md).

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

## Deploy-time dependencies

`compose()` decides the order components _build_; CloudFormation decides the order resources _deploy_, and it only orders B after A when B's template references A. Where no such reference exists — an SDK call whose parameters are hardcoded strings, a Lambda invoked during deployment, a certificate validated in a zone another resource delegates — the dependency has to be declared. Composing a system, use `dependsOn`; writing a builder, use `addDependencies`.

### In a composed system: `dependsOn`

Wrap the component in `dependsOn(component, { target, sources })` to declare the dependency beside it. `target` picks the construct in the component's result that depends on `sources`:

```ts
import { compose, dependsOn, ref } from "@composurecdk/core";
import { createCertificateBuilder } from "@composurecdk/acm";
import {
  createCrossAccountZoneDelegationBuilder,
  createHostedZoneBuilder,
  type CrossAccountZoneDelegationBuilderResult,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";

const zoneOf = (r: HostedZoneBuilderResult) => r.hostedZone;

compose(
  {
    zone: createHostedZoneBuilder().zoneName("app.example.com"),
    delegation: createCrossAccountZoneDelegationBuilder()
      .delegatedZone(ref("zone", zoneOf))
      .parentHostedZoneName("example.com")
      .delegationRole("arn:aws:iam::111122223333:role/delegation"),
    // ACM can only validate once the parent zone delegates to `zone`, but
    // nothing in the certificate's template references the NS record.
    certificate: dependsOn(
      createCertificateBuilder().domainName("app.example.com").validationZone(ref("zone", zoneOf)),
      {
        target: (r) => r.certificate,
        sources: [ref("delegation", (r: CrossAccountZoneDelegationBuilderResult) => r.record)],
      },
    ),
  },
  { zone: [], delegation: ["zone"], certificate: ["zone", "delegation"] },
);
```

- **Prefer a builder's own option when it has one.** [`@composurecdk/custom-resources`](https://github.com/laazyj/composureCDK/blob/main/packages/custom-resources/README.md)' `.dependsOn()` and [`@composurecdk/lambda`](https://github.com/laazyj/composureCDK/blob/main/packages/lambda/README.md)'s `.invokeOnDeploy({ after })` pick the target, and `.invokeOnDeploy()` also waits for the function's execution role.
- **Name one construct in `sources`.** A whole-component ref would also reach the delegation builder's role ([what `sources` accepts](#what-sources-accepts)).
- **Declare the sibling in the dependency record.** Refs in `sources` resolve against the build context. Under a nested system, a ref the inner record doesn't declare resolves to a parent component of the same name instead.
- **Mind stacks.** Under `withStacks`, the target must be in the source's stack or in one that deploys after it. Otherwise synth fails with a cyclic-reference error.
- **One target per wrapper.** To order two constructs of one component, nest two `dependsOn`s.

See [ADR-0022](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0022-deploy-dependencies-at-composition.md) for why this is a combinator and not a builder method.

### What `sources` accepts

`dependsOn`, `addDependencies` and the builder options above all take the same `DependencySource`s: a construct you already hold, a `ref` to one construct in a sibling's result, or a `ref` to the whole sibling.

A construct-level dependency already covers that construct's own children, so naming one is enough whenever what you need sits under it — ordering against a `RestApi` also orders against its deployment and stage. Naming the component instead also reaches its _peers_: an API's access log group, a queue's dead-letter queue, and any construct the component was passed.

### Inside a builder: `addDependencies`

In your builder's `build()`, call `addDependencies(target, sources, context)` with the context you were given. `dependsOn` and the builder options above are built on it:

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

## Construct IDs

Use these when a builder derives a construct ID from something the user supplied, such as a map key or a record name. The user wrote a key, not a construct ID, so the builder sanitises the ID it derives rather than constraining the key: the sanitise-derived-values rule of [ADR-0010](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0010-aws-property-constraints.md).

`constructId` replaces `/` and control characters with `-`, and throws on `{ } [ ]`, because they mean an unresolved CDK token has leaked into the ID, which would give a logical ID that changes between synths. Given several parts, it sanitises each and joins them with `-`. To sanitise one fragment inside a larger ID, use `sanitizeConstructId`. Sanitise only the part you derive, never the `id` your builder was given: under `compose` it can contain `/` on purpose ([ADR-0012](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0012-explicit-build-id-decoupled-from-compose-key.md)).

```ts
import { constructId } from "@composurecdk/core";

ruleSet.addRule(constructId(entry.key), options);
constructId("records", "a/b"); // "records-a-b"
```

A construct ID is part of the resource's logical ID. Adopting these in a builder that already passed such strings through unsanitised changes the logical ID of any resource whose input contained `/` or a control character, and CloudFormation replaces that resource.

## Testing

`@composurecdk/core/testing` holds `assertCopyPreservesState`, a test helper for builder authors that checks a builder's `[COPY_STATE]` hook. See [docs/testing.md](docs/testing.md).

## Examples

- [MultiStackApp](https://github.com/laazyj/composureCDK/blob/main/packages/examples/src/multi-stack-app.ts) — System composed with `withStacks` for multi-stack routing, demonstrates cross-component wiring with `ref`
- [StaticWebsiteStack](https://github.com/laazyj/composureCDK/blob/main/packages/examples/src/static-website/app.ts) — S3 + CloudFront composed system with `ref` and `afterBuild`
- [DynamoStreamProcessorStack](https://github.com/laazyj/composureCDK/blob/main/packages/examples/src/dynamo-stream-processor-app.ts) — Stream consumer and its DLQ built under one construct with `scoped`, tagged as a unit
