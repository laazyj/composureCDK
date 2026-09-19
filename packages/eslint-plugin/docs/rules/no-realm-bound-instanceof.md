# composurecdk/no-realm-bound-instanceof

Bans `instanceof` against a class reached through an `import`, in library `src/`.

- **Preset:** `recommended` (`error`)
- **Decision:** [ADR-0007](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0007-dual-esm-cjs-publishing.md), [ADR-0011](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0011-cross-component-relationship-guards.md), [ADR-0019](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0019-lint-rules-as-public-contract.md)

## Why

`instanceof` is realm-bound, and library source is published dual ESM/CJS. When both copies of a package load in one process — the dual-package hazard — each copy has its own class objects. An instance minted by one copy fails `instanceof` against the other copy's class, so the check returns `false` for a value that is plainly of that type.

That has already shipped as two bugs: **#384**, where a stack-singleton dedup was silently skipped and collided on a construct id, and **#385**, where a `StatementBuilder` went unrecognised and skipped the wildcard-resource security guard. Both failed silently, which is the characteristic danger here.

## ❌ Incorrect

```ts
import { StatementBuilder } from "./statement-builder.js";

if (value instanceof StatementBuilder) {
  // false across the dual-package boundary
}
```

## ✅ Correct

```ts
const STATEMENT_BUILDER = Symbol.for("composurecdk.statement-builder");

if (typeof value === "object" && value !== null && STATEMENT_BUILDER in value) {
  // a Symbol.for brand is realm-agnostic
}
```

For a CDK construct you cannot modify, brand the L2 by reading its L1 instead — `CfnResource.isCfnResource(x) && x.cfnResourceType === …`, per [ADR-0011](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0011-cross-component-relationship-guards.md).

## Every import is in scope by default, relative ones included

A relative import is **not** a same-realm guarantee by default. `./statement-builder.js` resolves separately in each copy of the package, which is exactly how #385 happened.

## Options

### `assumeNeverInstalledAsADependency`

```js
"composurecdk/no-realm-bound-instanceof": ["error", { assumeNeverInstalledAsADependency: true }]
```

Asserts that **this package cannot load twice in one process**, so its own modules resolve to one set of class objects. Relative imports are then treated as same-realm; everything else is still flagged, because whether a _dependency_ loads twice is a property of the consumer's install, not of your source.

**An application is the archetype** — nothing installs one as a dependency, so it genuinely loads once. Being `private` is not the test: a private package can still be a dependency, and one in this repo is depended on by seventeen others.

**A library must not set it**, even a single-format one. A consumer can install two versions of your library side by side, and then your relative imports duplicate exactly as a dual-published package's do — the hazard returns with the option silencing it. Shipping one module format is not sufficient; the condition is that nothing can install you twice.

Default `false`, which flags every import.

Only relative specifiers are exempted. A `#` subpath is **not**: Node's `imports` field can map one to an external package, so `#dep` may resolve into `node_modules` like any dependency.

### Why this is an option rather than a preset

Only one of the rule's two halves is a property of your own package, so a tier cannot express it — moving the whole rule into `dualPublishing` would silence the bare-specifier half, which is the half that caused both shipped bugs. See [ADR-0019](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0019-lint-rules-as-public-contract.md) and [#450](https://github.com/laazyj/composureCDK/issues/450).

## Not flagged

Neither can be duplicated by the hazard:

- **Globals and intrinsics** — `x instanceof RegExp`, `x instanceof Error`. They resolve to no import binding, so the scope walk skips them.
- **Classes declared in the same module** — the class and every `new` of it come from one evaluation of that module.

## Known gaps

Both uncommon in this ESM source:

- `import = require()` bindings.
- An intermediate call that breaks the chain — `getClasses().Bucket` reads a runtime value rather than the import.
- A **relative path that leaves the package** (`../../other/src/x.js`, possible in a workspace) is exempted by the option although it reaches a different package. This repo bans that import shape outright; a consumer's may not.
- A **tsconfig path alias** (`@app/thing`, `~/thing`) resolves in-package but looks bare, so it is still flagged under the option — an over-report, not a miss.
- A package importing **itself by name** (`@scope/pkg` from inside `@scope/pkg`) is treated as a dependency, so `assumeNeverInstalledAsADependency` does not exempt it. Conservative rather than wrong — it over-reports, never under-reports — and self-reference needs an `exports` field, which an application, the only legitimate setter of that option, does not have.

## How it works

Resolution is scope-aware, so a local shadowing an import name is correctly treated as a non-import binding. TS-only wrappers (`as`, `!`, `satisfies`, angle-bracket assertion) are unwrapped rather than trusted.
