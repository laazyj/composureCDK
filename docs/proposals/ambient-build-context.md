# Proposal: ambient build context

**Status:** experiment, for evaluation. Not an ADR — nothing here is decided.
**Context:** [#386](https://github.com/laazyj/composureCDK/issues/386), option (b) taken further.

This branch is a working demonstration, not a merge candidate. It exists so the
trade-off can be read as code rather than argued in the abstract.

## What it changes

`compose` and `taggedBuilder` push the context they are building with onto a
stack for the duration of that `build()` call. `resolve` falls back to the top
of that stack when it is handed no context of its own. A sub-builder built
inside an enclosing `build()` therefore inherits the enclosing context
automatically, whether or not anyone remembered to pass it down.

An explicit `context` argument always wins. The ambient value is a fallback for
the `undefined` case, never an override.

## What it buys

Refs work through a sub-builder with no action from the builder's author. That
is the one property neither option in #386 delivers:

- The **lint rule** (option a, shipped separately) catches the mistake at
  author time, but only inside this repo — `@composurecdk/eslint-plugin` is
  `private: true`, so it never reaches a consumer writing their own builder.
- The **uniform three-parameter signature** (option b) would not have prevented
  two of the four live bugs. `s3` and `cloudfront` already had the parameter
  and still dropped the context: the defect is at the call site, not in the
  signature.

Ambient context is the only one of the three that fixes the failure for code
this repo does not lint.

## Demonstration

Two packages have had their explicit threading **removed** on this branch, and
their regression tests from #393/#394 pass unchanged:

| Package | What was removed                                                         |
| ------- | ------------------------------------------------------------------------ |
| `ec2`   | `context` no longer threaded into `resolveFlowLogs` or the sub-builder   |
| `s3`    | `context` no longer threaded into `resolveAccessLogs` or the sub-builder |

To confirm the tests depend on the new mechanism rather than on leftover
plumbing, disable the fallback in `resolve` (drop `?? currentAmbientContext()`)
and re-run: both fail with the original
`Ref to "…" cannot be resolved: component not found in context`.

The other three fixed packages keep their explicit threading, so the branch
also shows the two styles coexisting — which is what any real migration would
look like.

## What it costs

**Data flow becomes implicit.** Thirty builders currently thread `context` by
hand, and that explicitness is a deliberate property of the codebase. After
this change, reading a builder no longer tells you where its sub-builder's refs
resolve from. That is the real objection, and it is not a small one.

**The parameter does not go away.** `build(scope, id, context?)` is the public
`Lifecycle` contract and callers pass it, so a conduit builder keeps the
parameter while no longer using it — see the `eslint-disable` for
`no-unused-vars` on `VpcBuilder.build`. Removing it outright narrows the public
signature and breaks callers; that was tried first here and broke `ec2`'s own
test. So the ceremony is reduced, not eliminated.

**A dual-package trap.** The stack must live on `globalThis` under a
`Symbol.for` key. Module-scoped state would give the ESM and CommonJS copies
separate stacks, so an ESM push would be invisible to a CommonJS `resolve` —
failing exactly the way this mechanism exists to prevent, and only in a
dual-loaded process. This is the same hazard `REF_BRAND` and ADR-0007 address,
so the technique is established here, but it is a correctness trap that a
future refactor could silently reintroduce. There is a test pinning it.

**It weakens a real error.** Today, resolving a ref against an empty context
throws. With a fallback in play, a ref that _should_ fail because a dependency
was never declared can instead find a same-named component in an enclosing
context and resolve to the wrong thing. The names come from the same context
the parent would have passed, so this is narrow — but it converts a loud
failure into a silent mis-wire, which is the worse direction.

**Synchrony is load-bearing.** A plain stack is safe only because
`Lifecycle.build` returns `T` and never a promise, so no two builds interleave.
If `build` ever became async this needs `AsyncLocalStorage`, which is
Node-only — a constraint this library does not otherwise have.

## Scope if it were adopted

This is ADR-scale: it changes `resolve`'s contract for every package. It would
need an ADR, a migration removing the now-redundant threading from the other
28 builders, and a `module-compat` test proving the cross-realm behaviour
against genuinely dual-loaded copies rather than the single-process proxy used
here.

## Recommendation

Ship the lint rule now; hold this. The rule costs nothing at runtime, keeps
data flow explicit, and covers every call site in this repo. Revisit this
proposal if consumer bug reports show the failure escaping into code the lint
rule cannot see — which is the gap it uniquely closes, and the only argument
strong enough to justify the implicitness.
