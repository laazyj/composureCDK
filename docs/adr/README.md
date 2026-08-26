# Architectural Decision Records

This directory holds ADRs — short notes that capture a decision, its context, and the trade-offs we accepted. New maintainers should read [architecture.md](../architecture.md) first for the big picture, then scan ADRs for decisions that amend or add detail to it.

## When to write an ADR

An ADR records an **architecturally significant** decision — one that changes the shape of the library, or binds work beyond the change that prompted it. Write one when the decision:

- introduces a cross-cutting mechanism other packages are expected to use — [ADR-0002](0002-policies.md) policies, [ADR-0011](0011-cross-component-relationship-guards.md) relationship guards;
- constrains every package — [ADR-0007](0007-dual-esm-cjs-publishing.md) dual publishing, [ADR-0008](0008-aws-cdk-lib-version-floors.md) version floors;
- reverses or supersedes a decision already recorded here; or
- resolves a trade-off a future maintainer would otherwise re-litigate, where the rejected options matter as much as the chosen one.

Do **not** write one for:

- an implementation choice local to one feature, or to a set of features within a single package — that belongs in the package README, next to the API it explains;
- applying an existing pattern to a new service or builder, however much code it takes. Reusing ADR-0011 for another guard, or [ADR-0015](0015-combine-multi-ref-combinator.md) for another multi-ref consumer, is the pattern working as intended — not a new decision;
- defaults, thresholds, or props tables — package READMEs document those with their rationale;
- anything you would have to argue is architectural. If it needs the argument, it isn't.

When in doubt, ship without one. A missing ADR is cheap to add later, once a second consumer proves the pattern is general; an unnecessary one dilutes an index every new maintainer is asked to read.

## Format

Each ADR is a single Markdown file named `NNNN-kebab-case-title.md`, numbered sequentially. Use this template:

```markdown
# ADR NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context

What forces produced this decision? What constraints or incidents motivated it?

## Decision

What are we doing? Be specific — rules, patterns, or mechanisms.

## Consequences

What becomes easier, what becomes harder, and what the reader should do differently as a result.
```

ADRs are append-only. To change a decision, write a new ADR that supersedes the old one and update the old one's `Status` to `Superseded by ADR-NNNN`. The exception is an ADR that never reached `Accepted`: a `Proposed` record can be withdrawn by deleting it, since nothing was decided for a later one to supersede.

## Index

- [ADR-0001: Builder type emission — export `*BuilderProps`, use `#` private fields](0001-builder-type-emission.md)
- [ADR-0002: Policies — cross-cutting helpers applied to a construct subtree](0002-policies.md)
- [ADR-0003: Nested `compose()` — propagate parent context into inner components](0003-nested-compose-context-propagation.md)
- [ADR-0004: Split-alarm builder pattern for AWS services with fixed-region metrics](0004-split-alarm-builder-for-fixed-region-metrics.md)
- [ADR-0005: `.copy()` on Builder for variant authoring and strategy hand-off](0005-builder-copy.md)
- [ADR-0006: Decorator pattern for cross-cutting builder features](0006-decorator-builder-pattern.md)
- [ADR-0007: Dual ESM/CJS publishing as an enforced standard](0007-dual-esm-cjs-publishing.md)
- [ADR-0008: Per-package aws-cdk-lib version floors](0008-aws-cdk-lib-version-floors.md)
- [ADR-0009: Defaults yield to a mutually-exclusive user-set sibling prop](0009-defaults-yield-to-mutually-exclusive-siblings.md)
- [ADR-0010: AWS-property constraints — a catalogue with central mechanism and local data](0010-aws-property-constraints.md)
- [ADR-0011: Cross-component relationship guards — builder-registered synth-time Aspects](0011-cross-component-relationship-guards.md)
- [ADR-0012: Explicit build id — decouple the construct id from the compose key](0012-explicit-build-id-decoupled-from-compose-key.md)
- [ADR-0013: Consumer-side IAM grants — declare a grant where the dependency already points](0013-consumer-side-grants.md)
- [ADR-0014: Role-parameterized builders for mutually-exclusive L2 surfaces](0014-role-parameterized-queue-builder.md)
- [ADR-0015: Combining multiple refs into one — the `combine()` Ref combinator](0015-combine-multi-ref-combinator.md)
- [ADR-0016: Encapsulate SDK-only operations as domain actions on the owning builder](0016-domain-action-custom-resource.md)
- [ADR-0017: Template-text validity as an opt-in Aspect, not builder enforcement](0017-template-text-policy.md)
- [ADR-0018: Re-declared builder props take their type from the CDK prop](0018-re-declared-props-track-cdk-prop-types.md)
