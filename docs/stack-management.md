# Stack Management

This guide covers how ComposureCDK organises components into CloudFormation Stacks. It progresses from the simplest approach to the most flexible, so you can adopt only what your system needs.

## Background

A CloudFormation Stack is the unit of deployment in AWS. Every resource belongs to exactly one Stack, and Stacks are deployed, updated, and deleted independently. See the [CDK documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html) for a full introduction to Stacks, constructs, and synthesis.
How you partition resources across Stacks has real consequences:

- **500 resources per Stack** — a hard CloudFormation limit. Large systems must split.
- **Cross-stack exports are immutable while imported** — you cannot modify or delete an export that another Stack references. This couples Stack lifecycles.
- **Split by lifecycle and ownership, not by service type** — group resources that change together and are owned by the same team, not by whether they are Lambda functions or DynamoDB tables.
- **Stack subclasses are common** — for example Amazon teams typically use `DeploymentStack` or other custom subclasses rather than `Stack` directly. ComposureCDK supports this through `ScopeFactory`.

## Approaches

### 1. Direct Stack (no ComposureCDK stack management)

Pass a Stack as the scope to `build`. ComposureCDK does not manage Stacks at all — you create them yourself.

```ts
const stack = new Stack(app, "MyStack");

compose({ handler, api }, { handler: [], api: ["handler"] }).build(stack, "MySystem");
```

**When to use:** Small systems where everything fits in one Stack and you don't need declarative Stack configuration. This is the starting point — adopt stack management features only when you need them.

### 2. StackBuilder

`createStackBuilder()` from `@composurecdk/cloudformation` provides declarative Stack configuration via the same fluent API used for other components.

```ts
import { createStackBuilder } from "@composurecdk/cloudformation";

const { stack } = createStackBuilder()
  .description("Service resources")
  .terminationProtection(true)
  .tag("team", "platform")
  .build(app, "ServiceStack");

compose({ handler, api }, { handler: [], api: ["handler"] }).build(stack, "MySystem");
```

StackBuilder supports every `StackProps` property as a fluent setter/getter, plus `.tag()` for applying tags that propagate to all resources in the Stack.

**When to use:** When you want consistent, declarative Stack configuration (tags, description, termination protection) but don't need multi-stack routing.

### 3. Stack Map (`.withStacks()`)

Route components to specific Stacks by name. Each component is built into its assigned Stack; components without a mapping use the default scope.

```ts
const { stack: serviceStack } = createStackBuilder()
  .description("Service resources")
  .build(app, "ServiceStack");

const { stack: apiStack } = createStackBuilder()
  .description("API resources")
  .build(app, "ApiStack");

compose({ handler, api }, { handler: [], api: ["handler"] })
  .withStacks({ handler: serviceStack, api: apiStack })
  .build(app, "MySystem");
```

CDK handles cross-stack references automatically — when the API in `apiStack` references the Lambda in `serviceStack`, CDK generates the necessary exports and imports.

**When to use:** When you need explicit control over which components go into which Stacks. Good for systems with a small, stable number of Stacks where the mapping is obvious.

### 4. Stack Strategies (`.withStackStrategy()`)

Strategies assign components to Stacks programmatically using rules rather than explicit mappings.

#### `singleStack`

All components share one auto-created Stack.

```ts
import { singleStack } from "@composurecdk/cloudformation";

compose({ handler, api }, { handler: [], api: ["handler"] })
  .withStackStrategy(singleStack())
  .build(app, "MySystem");
```

#### `groupedStacks`

Components are grouped by a classifier function. Each group gets its own Stack.

```ts
import { groupedStacks } from "@composurecdk/cloudformation";

compose({ handler, api, table }, { handler: [], api: ["handler"], table: [] })
  .withStackStrategy(groupedStacks((key) => (key === "table" ? "persistence" : "service")))
  .build(app, "MySystem");
```

Both `singleStack` and `groupedStacks` from `@composurecdk/cloudformation` default to creating CDK Stacks. Pass a custom `ScopeFactory` to use `DeploymentStack` or other subclasses:

```ts
import { singleStack } from "@composurecdk/cloudformation";
import { createStackBuilder } from "@composurecdk/cloudformation";

const factory = createStackBuilder()
  .terminationProtection(true)
  .tag("team", "platform")
  .toScopeFactory();

compose({ ... }, { ... })
  .withStackStrategy(singleStack(factory))
  .build(app, "MySystem");
```

**When to use:** When you want rule-based Stack assignment that scales with the number of components. Good for systems that grow over time — adding a component doesn't require updating a Stack map.

### Custom strategies

Implement the `StackStrategy` interface directly for advanced routing logic:

```ts
import { type StackStrategy } from "@composurecdk/core";

const myStrategy: StackStrategy = {
  resolve(scope, systemId, componentKey) {
    // Return the scope each component should be built in
  },
};
```

## Decision Guide

| Question                                                    | Recommendation                |
| ----------------------------------------------------------- | ----------------------------- |
| Everything fits in one Stack, no special config needed      | Direct Stack                  |
| One Stack, but want tags/description/termination protection | StackBuilder                  |
| Fixed number of Stacks, obvious component-to-Stack mapping  | `.withStacks()`               |
| Rule-based assignment, system may grow                      | `.withStackStrategy()`        |
| Custom Stack subclass (DeploymentStack, etc.)               | Any approach + `ScopeFactory` |

Start with the simplest approach that meets your needs. You can adopt more sophisticated stack management later without changing your component definitions — stack routing is a concern of `compose`, not individual components.

## Cross-Stack References

When components in different Stacks reference each other (via `ref`), CDK automatically creates CloudFormation exports and imports. This is convenient but comes with constraints:

- **Exports are immutable while imported.** If Stack A exports a value that Stack B imports, you cannot change or remove that export until Stack B no longer imports it. This means you cannot freely refactor cross-stack boundaries.
- **Deploy order matters.** The exporting Stack must be deployed before the importing Stack. CDK Pipelines handles this automatically; manual deploys require careful ordering.
- **Avoid unnecessary cross-stack references.** Co-locate components that are tightly coupled. Use cross-stack references for stable interfaces between loosely coupled groups.

## Per-Output Stack Routing

When a system spans multiple Stacks, `outputs()` can route individual entries to specific Stacks via the optional `scope` field on each definition. This preserves the declarative single-map form while keeping each output in the Stack that owns its resource.

`scope` accepts either an `IConstruct` (a direct Stack reference) or a component key string. Component keys are statically typed against the composed system's components, so typos are compile errors.

```ts
compose(
  { site: siteBuilder, cdn: cdnBuilder, dns: dnsBuilder },
  { site: [], cdn: ["site"], dns: [] },
)
  .withStacks({ site: siteStack, cdn: siteStack, dns: dnsStack })
  .afterBuild(
    outputs({
      SiteUrl: { value: ref("cdn", (r) => r.distribution.domainName), scope: "cdn" },
      BucketArn: { value: ref("site", (r) => r.bucket.bucketArn), scope: siteStack },
      NameServers: {
        value: ref("dns", (r) => Fn.join(",", r.zone.hostedZoneNameServers!)),
        scope: "dns",
      },
    }),
  )
  .build(app, "StaticWebsite");
```

When `scope` is omitted, the output falls back to the scope passed to `build()` — typically the app under `.withStacks()` or `.withStackStrategy()`, which means CDK will fail at synth if no owning Stack is reachable. Either omit `scope` only in the single-Stack case, or set it on every entry.

## Package Structure

Stack management is split across two packages:

- **`@composurecdk/core`** — `StackStrategy`, `ScopeFactory`, `singleStack(factory)`, `groupedStacks(classify, factory)`, and `.withStacks()` / `.withStackStrategy()` on `ComposedSystem`. Core depends only on `constructs`, not `aws-cdk-lib`.
- **`@composurecdk/cloudformation`** — `createStackBuilder()`, plus convenience `singleStack(factory?)` and `groupedStacks(classify, factory?)` that default to creating CDK Stacks. This package depends on `aws-cdk-lib`.

If you use CDK `Stack` (the common case), import strategies from `@composurecdk/cloudformation` for the default factory. If you use a custom Stack subclass, import from `@composurecdk/core` and provide your own `ScopeFactory`.
