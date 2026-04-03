# Extensions

This guide covers how to extend a composed system with post-build behaviour — creating CloudFormation outputs, applying tags, generating dashboards, or any other action that depends on the resources a system produces.

## Background

`compose` builds components in dependency order and returns their combined outputs. But many concerns sit _outside_ the component graph: stack outputs summarise the system, tags apply across all resources, monitoring dashboards reference multiple components. These are not components themselves — they are cross-cutting behaviour that runs after the system is built.

`afterBuild` is the extension point for this. It accepts a hook — a function that receives the scope, system id, and fully-typed build results — and runs it after all components have been built.

## AfterBuildHook

```ts
type AfterBuildHook<T extends object> = (scope: IConstruct, id: string, results: T) => void;
```

- **`scope`** — The construct scope passed to `build`. Hooks create constructs here.
- **`id`** — The system id passed to `build`.
- **`results`** — The combined build outputs of all components, keyed by component name.

## Using afterBuild

Chain `.afterBuild(hook)` on any `ComposedSystem`:

```ts
compose({ site, cdn }, { site: [], cdn: ["site"] })
  .afterBuild((scope, _id, results) => {
    console.log("Site bucket:", results.site.bucket.bucketName);
  })
  .build(stack, "MySystem");
```

### Chaining multiple hooks

Multiple `.afterBuild()` calls can be chained. Hooks run in registration order:

```ts
compose({ site, cdn }, { site: [], cdn: ["site"] })
  .afterBuild(outputs({ ... }))
  .afterBuild(tagging({ ... }))
  .build(stack, "MySystem");
```

### Composing with stack routing

`.afterBuild()` chains with `.withStacks()` and `.withStackStrategy()`:

```ts
compose({ handler, api, table }, { ... })
  .withStackStrategy(groupedStacks(key => key === "table" ? "persistence" : "service"))
  .afterBuild(outputs({
    ApiUrl: { value: ref("api", r => r.restApi.url), description: "API endpoint" },
  }))
  .build(app, "MySystem");
```

Stack routing methods (`.withStacks()`, `.withStackStrategy()`) are mutually exclusive — choose one. But any number of `.afterBuild()` hooks can follow.

## Package structure

The extension system spans two layers:

- **`@composurecdk/core`** defines `AfterBuildHook<T>`, `.afterBuild()` on `ComposedSystem`, and `ConfiguredSystem` (the chainable type returned by `.withStacks()`, `.withStackStrategy()`, and `.afterBuild()`). Core depends only on `constructs`, not `aws-cdk-lib`.
- **Domain packages** provide hook implementations. For example, `@composurecdk/cloudformation` exports `outputs()` which creates `CfnOutput` constructs.

## Writing a custom hook

A hook is any function matching `AfterBuildHook<T>`. For a reusable hook, write a factory that returns one:

```ts
import { type AfterBuildHook } from "@composurecdk/core";
import { Tags } from "aws-cdk-lib";

function applyTags(tags: Record<string, string>): AfterBuildHook<object> {
  return (scope) => {
    for (const [key, value] of Object.entries(tags)) {
      Tags.of(scope).add(key, value);
    }
  };
}

// Usage
compose({ ... }, { ... })
  .afterBuild(applyTags({ team: "platform", env: "prod" }))
  .build(stack, "MySystem");
```

Hooks that reference component results can use `Ref` and `resolve` from `@composurecdk/core` to resolve values lazily, just as builders do.

## Built-in hooks

### `outputs()` — `@composurecdk/cloudformation`

Creates CloudFormation stack outputs from the composed system's build results.

```ts
import { outputs } from "@composurecdk/cloudformation";
import { compose, ref } from "@composurecdk/core";

compose({ site, cdn }, { site: [], cdn: ["site"] })
  .afterBuild(
    outputs({
      DistributionUrl: {
        value: ref(
          "cdn",
          (r: DistributionBuilderResult) => `https://${r.distribution.distributionDomainName}`,
        ),
        description: "CloudFront distribution URL",
      },
      BucketName: {
        value: ref("site", (r: BucketBuilderResult) => r.bucket.bucketName),
        description: "S3 bucket name for site content",
      },
    }),
  )
  .build(stack, "StaticWebsite");
```

Each output definition accepts:

- **`value`** — A concrete string or a `Ref` that resolves against the build results.
- **`description`** — Optional description for the CloudFormation output.
- **`exportName`** — Optional export name for cross-stack references.
