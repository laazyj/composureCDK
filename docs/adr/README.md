# Architectural Decision Records

This directory holds ADRs — short notes that capture a decision, its context, and the trade-offs we accepted. New maintainers should read [architecture.md](../architecture.md) first for the big picture, then scan ADRs for decisions that amend or add detail to it.

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

ADRs are append-only. To change a decision, write a new ADR that supersedes the old one and update the old one's `Status` to `Superseded by ADR-NNNN`.

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
- [ADR-0013: Role-parameterized queue builder with per-role typed surfaces](0013-role-parameterized-queue-builder.md)
