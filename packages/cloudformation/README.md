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

### Scope factory

Convert a configured builder into a `ScopeFactory` for use with stack strategies:

```ts
const factory = createStackBuilder()
  .terminationProtection(true)
  .tag("team", "platform")
  .toScopeFactory();

compose({ ... }, { ... })
  .withStackStrategy(singleStack(factory))
  .build(app, "MySystem");
```

## Stack Strategies

Convenience wrappers around `@composurecdk/core`'s strategy primitives that default to creating Stacks via `createStackBuilder`. Pass an optional `ScopeFactory` to customise the Stack configuration.

### singleStack

Places all components in a single auto-created Stack:

```ts
import { singleStack } from "@composurecdk/cloudformation";

compose({ handler, api }, { handler: [], api: ["handler"] })
  .withStackStrategy(singleStack())
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
