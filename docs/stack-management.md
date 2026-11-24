# Stack Management

This guide covers how ComposureCDK organises components into CloudFormation Stacks. It progresses from the simplest approach to the most flexible, so you can adopt only what your system needs.

## Background

A CloudFormation Stack is the unit of deployment in AWS. Every resource belongs to exactly one Stack, and Stacks are deployed, updated, and deleted independently. See the [CDK documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html) for a full introduction to Stacks, constructs, and synthesis.
How you partition resources across Stacks has real consequences:

- **500 resources per Stack** — a hard CloudFormation limit. Large systems must split.
- **Cross-stack references couple Stack lifecycles** — how tightly is a decision you make, not a fixed property. See [Cross-Stack References](#cross-stack-references).
- **Split by lifecycle and ownership, not by service type** — group resources that change together and are owned by the same team, not by whether they are Lambda functions or DynamoDB tables.
- **Stack subclasses are common** — for example Amazon teams typically use `DeploymentStack` or other custom subclasses rather than `Stack` directly. ComposureCDK supports this: anywhere a Stack is expected, you can pass one you built, or a `Lifecycle` that builds one.

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

Route each component to a Stack by key. Every component key is required.

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

Each value is a **stack source**:

- **A Stack you have built.** The app holds it before the system builds, so it can attach removal policies, Aspects or `addDependency`. Any construct works, including a deployment framework's own `Stack` subclass.
- **A `Lifecycle` that builds one,** such as `createStackBuilder()`. It is built under its `at()` pin, or else `` `${systemId}-${key}` ``. Giving one builder to two keys builds two Stacks; to share one, pass a built Stack or use `groupedStacks`.
- **A `ref` to a Stack another component builds,** for a Stack that can't exist until that component has built. See [A Stack that needs a component](#a-stack-that-needs-a-component).
- **`BUILD_SCOPE`** (from `@composurecdk/core`), which keeps the component in the scope passed to `build()`. A nested system can then send one component, such as an alarm builder, to a `us-east-1` Stack and leave the rest with its parent.

A missing key, an `undefined` value or a key that is not a component fails to compile where the type can see it. In every case it throws a `StackPlacementError` when the system builds, naming the keys. That includes keys spread in at run time, such as one component per environment from `Object.fromEntries`.

CDK handles cross-stack references automatically — when the API in `apiStack` references the Lambda in `serviceStack`, CDK wires the value across for you. What it emits depends on the reference strength you have chosen; see [Cross-Stack References](#cross-stack-references).

**When to use:** when you want to say which Stack each component goes on. `.withStacks(map)` is the shortcut for `groupedStacks` with each key its own group (below).

### 4. Stack Strategies (`.withStackStrategy()`)

Every build of a system goes through a `StackStrategy`; `.withStacks()` is one, and with none set, every component builds in the scope passed to `build()`. `@composurecdk/core` provides two more. Both take stack sources, as above.

#### `singleStack`

All components share one Stack:

```ts
import { singleStack } from "@composurecdk/core";
import { createStackBuilder } from "@composurecdk/cloudformation";

compose({ handler, api }, { handler: [], api: ["handler"] })
  .withStackStrategy(singleStack(createStackBuilder().terminationProtection(true)))
  .build(app, "MySystem");
```

#### `groupedStacks`

Components are placed in named groups, and each group gets its own Stack. `groups` gives each group's stack source; the placement maps every component key to a group. Both are typed, so a key that is missing, or placed in a group that doesn't exist, fails to compile. A placed key that isn't a component, such as the old name left behind by a rename, still compiles, because the placement's keys are inferred from it; the build then throws a `StackPlacementError`. Only groups that some component is placed in are built.

**A Stack per Region.** CloudFront certificates and web ACLs, and Billing and Route 53 metrics, live only in `us-east-1`:

```ts
import { groupedStacks } from "@composurecdk/core";

compose({ site, cdn, cert, cdnAlarms }, { ... })
  .withStackStrategy(
    groupedStacks(
      {
        site: createStackBuilder().env({ account, region: "eu-west-2" }).crossRegionReferences(true),
        edge: createStackBuilder().env({ account, region: "us-east-1" }).crossRegionReferences(true),
      },
      { site: "site", cdn: "site", cert: "edge", cdnAlarms: "edge" },
    ),
  )
  .build(app, "Website");
```

References between Regions need `crossRegionReferences` on both Stacks, or a name both sides build the same way.

**Subsystems grouped into deployment units.** A Stack is a unit of deployment, so group the system's top-level subsystems by how they are deployed, not one Stack each. The apex DNS zone outlives every environment; the application deploys and tears down as one:

```ts
const { stack: dns } = createStackBuilder().terminationProtection(true).build(app, "ApexDns");

compose({ apexDns, ingestEdge, dataPlane, viewer }, { ... })
  .withStackStrategy(
    groupedStacks(
      { dns, app: createStackBuilder().description("Ingest, data plane and viewer") },
      { apexDns: "dns", ingestEdge: "app", dataPlane: "app", viewer: "app" },
    ),
  )
  .build(app, "Factory");
```

`dns` is built by the app, so it can depend on other Stacks, or they on it, before the system builds.

#### A Stack that needs a component

Some Stacks can't be built until part of the system has, such as a deployment framework's `Stack` whose environment comes from the pipeline. Build that Stack in a component of its own, and give the placement a `ref` to it:

```ts
const prodStack = createDeploymentStackBuilder().env(
  ref("pipeline", (r: PipelineResult) => r.pipeline.deploymentEnvironmentFor(prodAccount, region)),
);

compose(
  { pipeline, prodStack, ingestEdge },
  { pipeline: [], prodStack: ["pipeline"], ingestEdge: ["prodStack"] }, // placed on prodStack's Stack
)
  .withStackStrategy(
    groupedStacks(
      { app: BUILD_SCOPE, prod: ref<{ stack: Stack }>("prodStack").get("stack") },
      { pipeline: "app", prodStack: "app", ingestEdge: "prod" },
    ),
  )
  .build(app, "Factory");
```

- **Declare the Stack's component** in the dependency record of every component placed on it: that is what orders the build. Leave it out and the build throws a `StackPlacementError` naming the component. A cycle throws `CyclicDependencyError` when you compose.
- **There is no handle before build.** Removal policies, Aspects and dependencies on this Stack go in its builder, or in an `afterBuild` hook.

See [ADR-0024](adr/0024-stack-sources-that-a-component-builds.md).

#### Stack ids and renames

A builder source is built under `` `${systemId}-${group}` ``, so renaming a group renames its Stack, which CloudFormation treats as a new Stack. To keep the deployed Stack through a rename, do one of these:

- **Pin the stack name,** with `.stackName("Factory-Core")` on the builder. Logical ids are computed within the Stack, so its resources stay put. The CDK selector (`cdk deploy <id>`) and the paths in `cdk.out` still change.
- **Pin the construct id,** with `at("Factory-Core", createStackBuilder())`. For a top-level Stack with no stack name set, that is also its name, so nothing changes.

The strategies build a builder when the system builds. Pass `builder.copy()` when the original may be changed after hand-off ([ADR-0005](adr/0005-builder-copy.md)).

### Custom strategies

Implement `StackStrategy`'s `place`, which is called once per build with every component key, and returns the scope for each:

```ts
import { type StackStrategy } from "@composurecdk/core";

const byStage: StackStrategy = {
  place: (scope, systemId, keys) =>
    Object.fromEntries(keys.map((key) => [key, stageStacks[stageOf(key)]])),
};
```

`compose()` checks the answer as it does for `.withStacks()`, throwing a `StackPlacementError` that names the keys.

## Decision Guide

| Question                                                    | Recommendation                            |
| ----------------------------------------------------------- | ----------------------------------------- |
| Everything fits in one Stack, no special config needed      | Direct Stack                              |
| One Stack, but want tags/description/termination protection | StackBuilder, or `singleStack(builder)`   |
| Each component on a Stack you choose                        | `.withStacks()`                           |
| Stacks per Region, or per deployment unit of subsystems     | `groupedStacks`                           |
| The app needs a Stack before build (policies, deploy order) | Build it, and pass it as the stack source |
| Custom Stack subclass (DeploymentStack, etc.)               | Pass it, or a `Lifecycle` that builds it  |
| A Stack that needs a component built first (a pipeline)     | A component builds it; place with a `ref` |
| A rule no built-in strategy covers                          | A custom `StackStrategy`                  |

Start with the simplest approach that meets your needs. You can adopt more sophisticated stack management later without changing your component definitions — stack routing is a concern of `compose`, not individual components. See [ADR-0023](adr/0023-stack-strategy-is-the-one-routing-seam.md) for why routing has one mechanism.

## Cross-Stack References

When components in different Stacks reference each other (via `ref`), CDK wires the value across automatically. _How_ it does that is a decision you own, through the `@aws-cdk/core:defaultCrossStackReferences` feature flag — read from the **consuming** Stack's context. `CrossStackReferences.of(scope)` overrides it for one scope or resource.

| strength   | the consumer reads the value with | the producer's export                       |
| ---------- | --------------------------------- | ------------------------------------------- |
| `"strong"` | `Fn::ImportValue`                 | published, and pinned while imported        |
| `"weak"`   | `Fn::GetStackOutput`              | none — a plain output                       |
| `"both"`   | `Fn::GetStackOutput`              | published but unimported — a migration step |

Unconfigured, CDK behaves as `"strong"` and warns that the choice was never made. `"weak"` is CDK's recommended value. The table describes same-account, same-region references; see [CDK's reference-strength docs](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/README.md#reference-strength) for the cross-region mechanism (copied SSM parameters, not `Fn::ImportValue`) and for cross-account, which is always weak and records no Stack dependency. The flag's own description covers only the cross-region case, so it is easy to assume same-region references are unaffected — they are not.

`"strong"` buys a guarantee: CloudFormation refuses to change or remove an export while another Stack imports it, so a careless producer change cannot break a live consumer. `"weak"` trades that for freedom to move — nothing is pinned, so Stacks can be refactored and destroyed independently, and a producer dropping a value a consumer still reads surfaces as a failed deploy rather than a blocked one.

Long-lived systems usually want `"strong"`. Short-lived ones — ephemeral environments, stacks CI builds and tears down on every run — usually want `"weak"`, where a lingering export is a common cause of a teardown that will not complete. ComposureCDK's own examples set `"weak"` for that reason; see [`packages/examples/cdk.json`](../packages/examples/cdk.json).

Two things hold whichever strength you pick. Same-account references record a Stack dependency, so the producer deploys first — `cdk deploy` includes upstream dependencies unless you pass `--exclusively`. And cross-stack references are still worth avoiding where you can: co-locate components that are tightly coupled, and keep cross-stack references for stable interfaces between loosely coupled groups.

### Migrating from strong to weak

Two deploys, not one, because a producer cannot drop an export while a consumer still imports it:

1. Set the flag to `"both"`. The producer keeps its export and gains an output; consumers switch to `Fn::GetStackOutput`.
2. Deploy everywhere. CDK warns while you are here — `"both"` is a transitional state, not a destination.
3. Set the flag to `"weak"` and deploy again. The export goes, now that nothing imports it.

Going the other way, weak to strong, is a single deploy.

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

When `scope` is omitted, the output falls back to the scope passed to `build()` — typically the app when components are routed to other Stacks, which means CDK will fail at synth if no owning Stack is reachable. Either omit `scope` only in the single-Stack case, or set it on every entry.

## Package Structure

Stack management is split across two packages:

- **`@composurecdk/core`** — `StackStrategy`, `StackSource`, `BUILD_SCOPE`, `singleStack(source)`, `groupedStacks(groups, placement)`, and `.withStacks()` / `.withStackStrategy()` on `ComposedSystem`. Core depends only on `constructs`, not `aws-cdk-lib`.
- **`@composurecdk/cloudformation`** — `createStackBuilder()`, a stack source for any of the above. This package depends on `aws-cdk-lib`.
