# composurecdk/no-cdk-api-above-floor

Flags use of an `aws-cdk-lib` API newer than the package's supported peer-dependency floor.

- **Preset:** `internal` (`error`)
- **Decision:** [ADR-0008](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0008-aws-cdk-lib-version-floors.md)

## Why

Such calls compile fine — devDependencies track the latest CDK — but **throw at runtime** for a consumer on an older, still-supported version inside the declared `^2` peer range. Nothing else catches it: the type checker sees the newest CDK, and the unit suites run against it too.

[ADR-0008](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0008-aws-cdk-lib-version-floors.md) covers how the floors are chosen and enforced.

## ❌ Incorrect

```ts
import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";

if (CfnAlarm.isCfnAlarm(node)) {
  // TypeError on aws-cdk-lib < 2.231.0
}
```

## ✅ Correct

```ts
import { CfnResource } from "aws-cdk-lib";
import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";

if (CfnResource.isCfnResource(node) && node.cfnResourceType === CfnAlarm.CFN_RESOURCE_TYPE_NAME) {
  // what the static does internally, valid across the whole peer range
}
```

`@composurecdk/cloudwatch` does this internally, in its unexported `isCfnAlarm`; see [ADR-0011](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0011-cross-component-relationship-guards.md) for the pattern.

## The ban list

Currently one entry: the per-resource `Cfn<Resource>.isCfn<Resource>` L1 static type guards, which `aws-cdk-lib` first shipped on every generated L1 in **2.231.0** (verified by installing real versions — 2.230.0 lacks them). See issue #146.

`isCfnResource` and `isCfnElement` are explicitly allowed: they are core, predate the floor, and `isCfnResource` is the portable replacement.

The list is expected to grow as floors are pinned and lowered ahead of 1.0.0. Add an entry whenever an API turns out to postdate the floor.

## Known gaps

Both uncommon in this ESM source:

- Computed bracket access — `CfnAlarm["isCfnAlarm"](x)`.
- `import = require()` bindings.

## How it works

Matched by the accessed **member name** rather than the owning class identifier, so it holds regardless of how the class is imported or aliased — `CfnAlarm.isCfnAlarm`, `cw.CfnAlarm.isCfnAlarm`, `cdk.aws_cloudwatch.CfnAlarm.isCfnAlarm` all match.

Resolution runs through ESLint's scope manager, so a local shadowing the import name (a parameter called `CfnAlarm`, say) is correctly treated as a non-CDK binding. TS-only wrappers (`as`, `satisfies`, `!`, angle-bracket assertion) are unwrapped so they cannot smuggle a call past the rule. A call in the chain — `Stack.of(x).isCfnY()` — breaks the root link, since that reads a runtime value rather than the import.
