# CDK feature flags

`cdk-flags.json` records a decision for every feature flag `aws-cdk-lib` ships for a service this repo wraps. [AGENTS.md](../AGENTS.md#cdk-feature-flags) carries the rules; this is what the statuses mean and how the check decides what is in scope.

`npx nx cdk-flags:check` — part of `verify` and its own CI step — fails when a CDK upgrade introduces a flag with no entry, so the manifest cannot silently fall behind.

## Scope is the `modules` map

Each package lists the aws-cdk-lib modules it wraps, `[]` if it wraps none. That makes the boundary self-guarding in both directions: a new service's flags stay out of scope without an edit, and **a new package with no entry fails the check**, so its flags cannot leave review unnoticed.

CDK spells some modules more than one way (both `customresources` and `custom-resources`), so `check` also fails when a CDK module's name matches a package that does not list it. Flags CDK declares but removed in v2 are skipped; `check` derives those from the absence of `introducedIn.v2`.

## Statuses

Each entry carries a `status`, the `recommended` value it was decided against, and a reason — either its own `because` or the shared one in `statusReasons`. A status with no reason fails the check, and so does an entry whose `recommended` no longer matches CDK's, since a changed recommendation reopens the decision.

- **`adopted`** — set in [`packages/examples/cdk.json`](../packages/examples/cdk.json), with the value. `check` asserts the two agree; [`app-context.test.ts`](../packages/examples/test/app-context.test.ts) keeps the third copy, `EXAMPLE_CONTEXT`, in step.
- **`declined`** — a deliberate no.
- **`no-effect`** — setting it changes nothing in any example stack's synthesised cloud-assembly artifact.

## What `no-effect` is worth

It is evidence rather than judgement: `npx nx cdk-flags:audit` re-measures it, comparing each stack's template _and_ its artifact manifest rather than a chosen subset of fields, because a curated list only grows when someone notices a gap.

Widening the comparison does not close the other way a verdict goes hollow: the audit also has to supply the same synth _inputs_ the CDK CLI does, and `CLI_CONTEXT` in the script is a hand-maintained list of exactly that.

So read it narrowly — it says nothing changes in the stacks we ship, not that the flag cannot affect a builder no example exercises. Where the real reason is that a builder already guarantees the flag's intent, say so in `because` instead of leaning on the shared reason.

`audit` is manual rather than part of `verify` because it synthesises the whole example app once per flag — the same split as `cdk-floors establish` versus `cdk-floors check`. Run it after a CDK upgrade, and whenever an example starts exercising something it did not before.
