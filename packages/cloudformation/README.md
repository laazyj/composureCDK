# @composurecdk/cloudformation

CloudFormation builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for CloudFormation Stacks, convenience stack strategies, and a post-build hook for creating CloudFormation outputs from composed systems.

## Stack Builder

```ts
import { createStackBuilder } from "@composurecdk/cloudformation";

const { stack } = createStackBuilder()
  .description("Network infrastructure")
  .terminationProtection(true)
  .build(app, "NetworkStack");
```

Every [StackProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.StackProps.html) property is available as a fluent setter on the builder.

### Tags

Add tags that propagate to all resources within the stack:

```ts
const { stack } = createStackBuilder()
  .tag("team", "platform")
  .tag("environment", "production")
  .build(app, "ServiceStack");
```

### Variants and snapshots with `.copy()`

`.copy()` returns an independent builder with the same configured state. Use it to derive variants from a shared base, or to snapshot a builder before handing it to a stack strategy that may be invoked after further mutations:

```ts
const baseStack = createStackBuilder().tag("team", "platform");

const { stack: us } = baseStack.copy().description("US region").build(app, "UsStack");
const { stack: eu } = baseStack.copy().description("EU region").build(app, "EuStack");
```

## Stack Strategies

Convenience wrappers around `@composurecdk/core`'s strategy primitives. Both accept a `Lifecycle<StackBuilderResult>` (typically an `IStackBuilder`) and default to a fresh `createStackBuilder()` per call.

### singleStack

Places all components in a single auto-created Stack:

```ts
import { singleStack } from "@composurecdk/cloudformation";

compose({ handler, api }, { handler: [], api: ["handler"] })
  .withStackStrategy(singleStack())
  .build(app, "MySystem");
```

Pass a configured builder to apply tags, description, etc. to the strategy's stack. Use `.copy()` to snapshot the configuration when the original may be mutated later:

```ts
const base = createStackBuilder().tag("team", "platform");

compose({ ... }, { ... })
  .withStackStrategy(singleStack(base.copy()))
  .build(app, "MySystem");
```

### groupedStacks

Groups components into named Stacks by a classifier function:

```ts
import { groupedStacks } from "@composurecdk/cloudformation";

compose({ handler, api, table }, { ... })
  .withStackStrategy(
    groupedStacks((key) => (key === "table" ? "persistence" : "service")),
  )
  .build(app, "MySystem");
```

The same builder is invoked once per group key with `${systemId}-${group}` as the id, so any tags configured on the supplied builder propagate to every stack the strategy creates. As with `singleStack`, pass `builder.copy()` to snapshot the configuration when the original may be mutated after hand-off:

```ts
const base = createStackBuilder().tag("team", "platform");

compose({ ... }, { ... })
  .withStackStrategy(
    groupedStacks((key) => (key === "table" ? "persistence" : "service"), base.copy()),
  )
  .build(app, "MySystem");
```

## outputs

A post-build hook that creates CloudFormation stack outputs from a composed system's build results. Output values can be concrete strings or `Ref`s that resolve against the system's results.

```ts
import { compose, ref } from "@composurecdk/core";
import { outputs } from "@composurecdk/cloudformation";

compose(
  { site: createBucketBuilder(), cdn: createDistributionBuilder() },
  { site: [], cdn: ["site"] },
)
  .afterBuild(
    outputs({
      DistributionUrl: {
        value: ref("cdn", (r) => `https://${r.distribution.distributionDomainName}`),
        description: "CloudFront distribution URL",
      },
      BucketName: {
        value: ref("site", (r) => r.bucket.bucketName),
        description: "S3 bucket name for site content",
      },
    }),
  )
  .build(stack, "StaticWebsite");
```

## Examples

- [MultiStackApp](../examples/src/multi-stack-app.ts) — REST API + Lambda split across stacks via `.withStacks()`
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — CloudFormation outputs with `afterBuild` and `outputs`
