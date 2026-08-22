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

## templateTextPolicy

CloudFormation stores template text as ASCII. An em-dash, a curly quote or an ellipsis is **silently transliterated to `?` at deploy time** — no error, no `CREATE_FAILED`. The deployed template simply stops matching the synthesised one, so `cdk diff` reports a change on every run afterwards, forever, on a stack nobody touched. The only way out is to notice the character and strip it by hand.

`templateTextPolicy` is a [Policy](../../docs/architecture.md#policies) that finds those characters at synth time instead.

```ts
import { templateTextPolicy } from "@composurecdk/cloudformation";

templateTextPolicy(app); // fail synth on anything CloudFormation would rewrite
```

### Modes

| `onViolation`         | Behaviour                                                                                         | Use it when                                                |
| --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `"throw"` _(default)_ | Fails synth, naming the construct path, the field and the offending character.                    | You want the text fixed at the source.                     |
| `"sanitize"`          | Rewrites the value so the synthesised template matches what CloudFormation stores. Nothing fails. | A large existing estate you cannot chase string by string. |
| `"warn"`              | Annotates every violation and carries on.                                                         | Adoption: run it, fix the list, then switch to `"throw"`.  |

`sanitize` replaces per character, not per run — `“value”` becomes `"value"`, not a single `-`. Common typographic characters map to readable ASCII; anything else becomes `?`, which is what CloudFormation would have stored anyway. Override with `replace`:

```ts
templateTextPolicy(app, {
  onViolation: "sanitize",
  replace: (char) => (char === "€" ? "EUR" : transliterate(char)),
});
```

One field is not cosmetic: `AWS::CloudFront::Function`'s `functionCode` is executable source, so a `?` substituted into a string literal there is a behaviour change rather than a tidier template. Use `"throw"` or `"warn"` for an estate with CloudFront Functions.

### Why it is opt-in

Enforcing this inside every builder would turn a working — if diff-noisy — deployment into a synth failure for anyone who has been living with the transliteration. Installing the policy is how you say you would rather know. Constraints whose violation fails the _deploy_ rather than merely the diff, such as an EC2 `GroupDescription`, stay enforced at the builder regardless ([ADR-0010](../../docs/adr/0010-aws-property-constraints.md)).

An Aspect also reaches further than a builder can. A per-builder validator only covers fields someone remembered to wire one into — which is exactly how the stack-level `Description` slipped through, since `StackBuilder` passes `description` straight to `StackProps`. The Aspect walks the whole construct tree, so for the resource types it knows about it also catches constructs this library never built: raw L1s and other libraries' L2s alike.

### What it checks

The stack's own `Description`, every `CfnOutput` / `CfnParameter` description, and these resource properties:

| Resource type                                                                             | Property           |
| ----------------------------------------------------------------------------------------- | ------------------ |
| `AWS::CloudFront::Function`                                                               | `functionCode`     |
| `AWS::CloudWatch::Alarm`, `AWS::CloudWatch::CompositeAlarm`                               | `alarmDescription` |
| `AWS::Lambda::Function`, `AWS::Events::Rule`, `AWS::IAM::Role`, `AWS::IAM::ManagedPolicy` | `description`      |
| `AWS::ApiGateway::RestApi`, `Stage`, `Deployment`, `UsagePlan`, `ApiKey`                  | `description`      |
| `AWS::Neptune::DBClusterParameterGroup`, `AWS::Neptune::DBParameterGroup`                 | `description`      |
| `AWS::EC2::SecurityGroup`                                                                 | `groupDescription` |
| `AWS::SNS::Topic`                                                                         | `displayName`      |

`functionCode` is the odd one out: a whole JavaScript body rather than a line of prose. It is in the list because it is usually the largest block of free text in a template, and often the only one built from external data — a redirect map read at synth carries whatever was pasted into it. The cost is a wider blast radius than another `description`: a legitimately non-ASCII string literal in a function — a `€` in a redirect target, a non-Latin `Location` header — becomes a synth failure rather than a silent bad deploy. Run `"warn"` first if that might be you.

That is a seed list, not the whole of CloudFormation — several hundred resource types declare a free-text property. Add the ones you use:

```ts
templateTextPolicy(app, { fields: { "AWS::Custom::Widget": ["notes"] } });
```

Keys are CloudFormation resource types; values are **CDK L1 property names** (camelCase — `alarmDescription`, not `AlarmDescription`). `fields` is merged over the built-in registry, never replacing it, so a built-in entry cannot be narrowed away from config.

### What it does not cover

- Values that resolve to a CloudFormation intrinsic (`Ref`, `Fn::ImportValue`) — the text is not knowable at synth. A `Lazy` that resolves to a plain string **is** checked.
- Values written through `addPropertyOverride`, or set on a bare `CfnResource`'s `properties`. Both bypass the typed L1 accessor the policy reads.
- Nested properties such as `DistributionConfig.Comment` and `FunctionConfig.Comment` — so CloudFront is covered at `functionCode` only, not wherever a comment can be typed.
- Resource types and properties not in the table above, until you add them. A property name that does not match an L1 accessor is skipped silently — the same outcome as not listing it.

To check a single value directly rather than a whole tree, use `constraints.validate.templateText` / `constraints.sanitize.templateText` ([catalogue](../../docs/constraints.md)).

## Examples

- [MultiStackApp](../examples/src/multi-stack-app.ts) — REST API + Lambda split across stacks via `.withStacks()`
- [StaticWebsiteStack](../examples/src/static-website/app.ts) — CloudFormation outputs with `afterBuild` and `outputs`
