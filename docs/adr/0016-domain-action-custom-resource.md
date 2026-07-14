# ADR 0016: Encapsulate SDK-only operations as domain actions on the owning builder

- **Status:** Proposed
- **Date:** 2026-07-12

## Context

Some AWS operations have **no CloudFormation resource** — they are SDK calls only (e.g. `ses:SetActiveReceiptRuleSet`, the call that makes a receipt rule set actually receive mail). In a raw CDK system the consumer models these themselves as a standalone `AwsCustomResource`, or a `Provider` + handler Lambda, wired up alongside — but disconnected from — the resource they concern.

That plumbing sits outside the domain. The consumer has to know the SDK call, its IAM, its ordering, and its teardown semantics — none of which read as the intent ("make this rule set active"). Where a builder already owns the domain the operation belongs to, that knowledge belongs with it.

## Decision

**Encapsulate an SDK-only operation as a domain action — a `<verb>()` method — on the builder that owns its domain.** The builder expresses the operation in the language of its domain (`.activate()`, not "call `SetActiveReceiptRuleSet` with these parameters"), owns its IAM scoping and lifecycle, and exposes the resulting custom resource on its build result ([architecture.md — build results must be complete](../architecture.md#build-results-must-be-complete)). The consumer declares intent; the builder owns the plumbing.

This is the primary decision, and it is **independent of how the operation is backed**. That backing is a secondary, per-operation implementation choice:

1. **Stateless single call** (one fixed SDK call per lifecycle event) → reuse `@composurecdk/custom-resources` (`createAwsCustomResourceBuilder`). Prefer it; it scopes IAM and reads as intent.
2. **Stateful / conditional** (the correct action depends on current remote state — describe-then-act, delete-ordering, idempotency) → a purpose-built `Provider` fronting a handler Lambda. `AwsCustomResource` runs one fixed call per event with no hook to branch on a response, so it cannot express this; forcing it means an unconditional call, often unsafe (clobbering account-level state another stack owns). For the handler, extract the decision logic into a typed, unit-tested function and serialise it into the Lambda via `.toString()`, keeping only a thin SDK adapter inline; scope IAM to exactly the actions it calls.

When the operation's absence is a silent footgun, default the action on and make the on-by-default path safe.

The first application is `@composurecdk/ses` `.activate()`: a receipt rule set is inert until it is the account's active set, so activation is encapsulated as `.activate()` on the rule-set builder (on by default). Its backing happens to be case 2 — because activation must not clobber another stack's active set on teardown, it uses a provider that conditionally deactivates — but the encapsulation decision would stand regardless of that choice.

## Consequences

- SDK-only operations a domain builder owns are expressed as domain actions, not consumer-assembled plumbing — encapsulated, in-domain, IAM-scoped, and surfaced on the build result.
- The stateless-vs-stateful backing is implementation guidance, not part of the core decision: the same `.activate()` encapsulation would hold even if activation used an unconditional stateless `AwsCustomResource`.
- **Proposed** until a second SDK-only operation is encapsulated this way. The second instance prices whether to extract shared scaffolding — a `domainActionProvider(scope, id, { handler, actions })` for the stateful case, and/or handler-serialisation helpers — rather than each builder rolling its own.
- Consumers running multiple instances of an account-global operation (e.g. several SES rule sets across stacks) must understand the shared-state arbitration; document it on the builder, and keep `createAwsCustomResourceBuilder` as the escape hatch for bespoke behaviour.
