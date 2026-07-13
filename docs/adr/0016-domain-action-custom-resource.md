# ADR 0016: Domain-action custom resources — purpose-built providers for stateful SDK-only operations

- **Status:** Proposed
- **Date:** 2026-07-12

## Context

Some AWS operations have **no CloudFormation resource** — they are SDK calls only. [`@composurecdk/custom-resources`](../../packages/custom-resources) wraps CDK's `AwsCustomResource` for these, and for a **stateless** operation (one fixed SDK call per lifecycle event) it is the right tool.

A subset are **stateful**: the correct action on a lifecycle event depends on current remote state. The delete handler in particular may need to _read_ state, _decide_, then _maybe act_ — a read-modify-write. `AwsCustomResource` runs one fixed call per event with parameters frozen at synth time and no hook to branch on a call's response, so it structurally cannot express this. Forcing such an operation through it means falling back to an unconditional call, which is often unsafe — e.g. clobbering account-level state another stack owns.

Conditional/multi-step logic needs a **provider with a custom handler** (`Provider` + a handler Lambda) — a different construct from the declarative `AwsCustomResource`, not a gap to patch into it. Where a domain builder owns such an operation, this shape recurs, which is the bar for an ADR (per the [#280 / PR #294 review](https://github.com/laazyj/composureCDK/issues/279#issuecomment-4946384322)).

## Decision

Model an SDK-only operation a domain builder owns as a **domain action** (a `<verb>()` method), and pick the backing by the operation's shape:

1. **Stateless single call** → reuse `@composurecdk/custom-resources` (`createAwsCustomResourceBuilder`). Prefer this; it scopes IAM and reads as intent.
2. **Stateful / conditional** (describe-then-act, delete-ordering, idempotency that depends on remote state) → a **purpose-built provider**: a `Provider` fronting a handler Lambda that branches on `event.RequestType` and remote state.

Rules for the provider case:

- **Extract the decision logic into a typed function and unit-test it**, then serialise it into the handler via `.toString()`; keep only the SDK adapter inline. The behaviour that matters is type-checked and tested; only trivial call-wiring is unverified.
- **Expose the custom resource on the build result** ([architecture.md — build results must be complete](../architecture.md#build-results-must-be-complete)).
- **Default the action on when its absence is a silent footgun**, and make the on-by-default path safe (e.g. conditional teardown that touches only state this resource owns).
- **Scope IAM to exactly the actions the handler calls.**

The first application is `@composurecdk/ses` `.activate()`: a receipt rule set is inert until it is the account's active set (`ses:SetActiveReceiptRuleSet`, no CFN resource), so `.activate()` is on by default, and on delete it clears the active slot only when the active set is ours.

## Consequences

- Stateful SDK-only operations get a provider + typed handler rather than an unsafe unconditional `AwsCustomResource` call; the decision logic is tested, and the inline residue is a thin SDK adapter.
- **Proposed** until a second stateful domain-action lands. That second case prices whether to extract a shared `domainActionProvider(scope, id, { handler, actions })` — or grow a handler-based capability inside `@composurecdk/custom-resources` — rather than each builder rolling its own `Provider`.
- Consumers running multiple instances of an account-global operation (e.g. several SES rule sets across stacks) must understand the shared-state arbitration; document it on the builder and keep `createAwsCustomResourceBuilder` as the escape hatch for bespoke behaviour.
