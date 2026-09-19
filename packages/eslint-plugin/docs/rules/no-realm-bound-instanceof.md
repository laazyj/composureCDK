# composurecdk/no-realm-bound-instanceof

Bans `instanceof` against a class reached through an `import`, in library `src/`.

- **Severity in `recommended`:** `error`
- **Decision:** [ADR-0007](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0007-dual-esm-cjs-publishing.md), [ADR-0011](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0011-cross-component-relationship-guards.md)

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

## Every import is in scope, relative ones included

A relative import is **not** a same-realm guarantee. `./statement-builder.js` resolves separately in each copy of the package, which is exactly how #385 happened.

## Not flagged

Neither can be duplicated by the hazard:

- **Globals and intrinsics** — `x instanceof RegExp`, `x instanceof Error`. They resolve to no import binding, so the scope walk skips them.
- **Classes declared in the same module** — the class and every `new` of it come from one evaluation of that module.

## Known gaps

Both uncommon in this ESM source:

- `import = require()` bindings.
- An intermediate call that breaks the chain — `getClasses().Bucket` reads a runtime value rather than the import.

## How it works

Resolution is scope-aware, so a local shadowing an import name is correctly treated as a non-import binding. TS-only wrappers (`as`, `!`, `satisfies`, angle-bracket assertion) are unwrapped rather than trusted.
