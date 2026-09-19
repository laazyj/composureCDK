# composurecdk/builder-must-be-tagged

Flags `Builder()` or `IBuilder<…>` imported from `@composurecdk/core` in a library builder, where the tagged equivalents belong.

- **Preset:** `internal` (`error`)

## Why

Tagging is a cross-cutting concern every deployable resource needs, and it is not something each builder should re-invent. `taggedBuilder` / `ITaggedBuilder` from `@composurecdk/cloudformation` wrap the core builder with the shared tagging surface, so a consumer gets the same `.tags(…)` API on every builder in the library rather than on whichever ones remembered.

`@composurecdk/core` stays CDK-agnostic and cannot provide this itself — tagging is a CloudFormation concern, so the tagged wrapper lives one layer up.

## ❌ Incorrect

```ts
import { Builder, type IBuilder } from "@composurecdk/core";

export function createBucketBuilder(): IBuilder<BucketBuilderProps, Bucket> {
  return Builder(BucketBuilderImpl);
}
```

## ✅ Correct

```ts
import { taggedBuilder, type ITaggedBuilder } from "@composurecdk/cloudformation";

export function createBucketBuilder(): ITaggedBuilder<BucketBuilderProps, Bucket> {
  return taggedBuilder(BucketBuilderImpl);
}
```

## Escape hatch

Some CloudFormation resources have no `Tags` property at all — Route53 records, IAM `ManagedPolicy`, SNS `Subscription`, AWS Budgets. A builder wrapping one of those cannot be tagged, so disable the rule on the line and name the resource, keeping the exception visible in review:

```ts
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::Route53::RecordSet has no Tags property
return Builder(RecordSetBuilderImpl);
```

The implementation of the tagged wrapper itself is exempt in this repo's root config — `packages/cloudformation/src/tagged-builder.ts` _is_ the tagged surface, so by definition it reaches for the core builder.

## How it works

Syntactic. The rule looks for `Builder` / `IBuilder` bindings imported from `@composurecdk/core` and reports their use.
