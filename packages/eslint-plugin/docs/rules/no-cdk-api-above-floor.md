# composurecdk/no-cdk-api-above-floor

Flags use of an `aws-cdk-lib` API newer than the package's supported peer-dependency floor. **Takes an option.**

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

## Options

### `floor`

```js
"composurecdk/no-cdk-api-above-floor": ["error", { floor: "2.93.0" }]
```

The lowest `aws-cdk-lib` version the linted code supports, as `major.minor.patch` — normally the bottom of your `peerDependencies` range. An API is reported only where it arrived **after** the floor, so the same ban list is correct for every package whatever its floor, and an entry costs nothing where the floor is already above it.

**Unset, every banned API is reported**, as though the floor were the bottom of `aws-cdk-lib` v2. That is the conservative reading of a package that has not said what it supports.

Set it per package where floors differ. This repo reads each package's floor from its `cdk-floors.json` manifest and configures the rule once per package, for `test/` as well as `src/`: its floor guard runs each package's whole suite — typecheck included — against that floor, so a test is bound by it exactly as source is.

## The ban list

Each entry is a fact about `aws-cdk-lib`, not a policy about a package. Every version is the first release carrying the API, verified by installing the releases either side of it.

| API                                                | Since   | Use instead                                                                                                           |
| -------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `Cfn<Resource>.isCfn<Resource>` static type guards | 2.231.0 | `CfnResource.isCfnResource(x) && x.cfnResourceType === Cfn<Resource>.CFN_RESOURCE_TYPE_NAME` — see below.             |
| `Match.stringLikeRegexp`                           | 2.9.0   | An exact value, or a plain regular expression tested against the value read from `Template.toJSON()`.                 |
| `Annotations.addWarningV2`                         | 2.93.0  | `addWarning`, or feature-detect `addWarningV2` and fall back — `@composurecdk/cloudformation`'s template-text policy. |
| `Annotations` from `aws-cdk-lib/assertions`        | 2.10.0  | The construct metadata it reads: `node.metadata` entries of type `aws:cdk:warning` or `aws:cdk:error`.                |

The `isCfn*` guards shipped on every generated L1 in 2.231.0 (2.230.0 lacks them); see issue #146. `isCfnResource` and `isCfnElement` are explicitly allowed: they are core, predate every floor, and `isCfnResource` is the portable replacement.

Add an entry whenever an API turns out to postdate a floor. Adding one makes the rule report where it did not, which is a breaking change to the rule ([Versioning](../../README.md#versioning)); with `floor` set, it reaches only the packages whose floor is below the new entry.

## Known gaps

- Computed bracket access — `CfnAlarm["isCfnAlarm"](x)`.
- `import = require()` bindings.
- An instance member reached through a variable — `const a = Annotations.of(x); a.addWarningV2(…)`. The rule follows the chain through `Annotations.of(x)` back to the import, but not through an assignment. That same blind spot is what lets the feature-detecting fallback through, which is correct.
- A re-export — `export { Annotations } from "aws-cdk-lib/assertions"`.

## How it works

A banned **member** is matched by the accessed member name rather than the owning class identifier, so it holds regardless of how the class is imported or aliased — `CfnAlarm.isCfnAlarm`, `cw.CfnAlarm.isCfnAlarm`, `cdk.aws_cloudwatch.CfnAlarm.isCfnAlarm` all match. An instance member (`addWarningV2`) is traced back through the call that produced the instance, `Annotations.of(x)`.

A banned **export** is matched where it is imported by name (type-only imports included — the floor's typecheck rejects those too) and where it is read off a namespace for its module: `import * as assertions from "aws-cdk-lib/assertions"`, the root's `assertions` re-export, or `cdk.assertions`.

Resolution runs through ESLint's scope manager, so a local shadowing the import name (a parameter called `CfnAlarm`, say) is correctly treated as a non-CDK binding. TS-only wrappers (`as`, `satisfies`, `!`, angle-bracket assertion) are unwrapped so they cannot smuggle a call past the rule. For a static member, a call in the chain — `Stack.of(x).isCfnY()` — breaks the root link, since that reads a runtime value rather than the import.
