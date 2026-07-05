# ADR 0015: Combining multiple refs into one — the `combine()` Ref combinator

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

`ref()` captures a lazy reference to **one** component's build output and resolves
it against the build context during `build()`. A `Resolvable<T>` — the union
`T | Ref<T>` — is the currency every builder seam speaks: `addMethod`,
`addIntegration`, and the like all accept one, and internally call
`resolve(value, context)`. This one-reference-per-value shape covers almost all
wiring, because a consumer usually adapts a single dependency into the form it
needs.

Some constructs, though, are assembled from **more than one** sibling at once. A
direct API Gateway → AWS-service `AwsIntegration` (API Gateway calling DynamoDB,
SQS, S3, … without a Lambda hop) needs two siblings simultaneously: the target's
identifier — a table's `tableName`, interpolated into the VTL request template —
**and** the `credentialsRole` API Gateway assumes to make the call. A single
`ref` reaches only one of them.

Absent a combinator, the workaround was to introduce a component whose only job
is to merge two sibling refs into one object — a fake `Lifecycle` that builds
nothing:

```ts
// ANTI-PATTERN: a component that exists only to merge two sibling refs
const tableAndRole = {
  build: (_s, _i, ctx) => ({
    tableName: (ctx.table as TableV2BuilderResult).table.tableName,
    role: (ctx.apiRole as RoleBuilderResult).role,
  }),
};
```

This is a smell. It manufactures a node in the `compose` graph that models no
resource, forces untyped `ctx[...] as ...` casts, and exists purely to work
around `ref`'s single-component reach.

## Decision

Add `combine(refs, transform?)` to `@composurecdk/core` — a **Ref combinator**.
It takes a record of `Resolvable` values, resolves each against the build
context, assembles the results into a record keyed the same way, and returns a
**single `Ref`** to that record. An optional `transform` maps the merged record
to the value the consumer needs (shorthand for `combine(refs).map(transform)`).

```ts
export type Resolved<R> = R extends Ref<infer T> ? T : R;

export function combine<R extends Record<string, unknown>>(
  refs: R,
): Ref<{ [K in keyof R]: Resolved<R[K]> }>;
export function combine<R extends Record<string, unknown>, U>(
  refs: R,
  transform: (values: { [K in keyof R]: Resolved<R[K]> }) => U,
): Ref<U>;
```

Three properties make it fit the existing model rather than extend it:

1. **It returns a `Ref`.** The result is an ordinary `Ref`, so it drops into any
   `Resolvable<T>` seam that already exists — no builder learns a new type, and
   the combined value composes further with `.get()`/`.map()`.
2. **It owns nothing.** `combine` resolves references and merges values; it
   creates no construct and holds no state. Every sibling it references remains a
   first-class node in the `compose` graph, declared and wired by the system
   author.
3. **Its types are inferred.** `Resolved<R>` mirrors what `resolve` does at
   runtime — a `Ref<T>` yields `T`, a concrete value passes through — so the
   merged record's keys and types follow from the input with no annotation, and
   entries may freely mix refs and concrete values.

The AWS-service integration is then just one application: the credentials role is
a plain `createServiceRoleBuilder("apigateway.amazonaws.com")` sibling that the
system grants against with consumer-side grants ([ADR-0013](0013-consumer-side-grants.md)),
and `combine` merges that role with the target into the `AwsIntegration` handed
to `addMethod`. No dedicated builder, no auto-created role, no new apigateway
surface.

### When to use it

Reach for `combine` only when a single `ref` genuinely cannot express the
dependency — i.e. **one construct is assembled from two or more distinct
siblings**. The canonical case is a construct that interpolates one sibling's
identifier while referencing another sibling's identity.

### When not to use it

- **One sibling, reshaped.** Use `ref(component, transform)` or `.get()`/`.map()`.
  A `combine` with a single entry is a needless wrapper.
- **Wiring a permission.** Use a consumer-side grant on the grantee
  ([ADR-0013](0013-consumer-side-grants.md)), not a `combine` that hand-assembles
  a role into a construct. `combine` is for _reading_ sibling values, not for
  routing IAM.
- **As an ownership escape hatch.** `combine` does not make a consumer own a
  resource. If a resource needs an owner in the builder surface, that is a builder
  design question, not something to paper over by merging refs.

## Consequences

- The fake-`Lifecycle` merge is gone: a consumer needing several siblings names
  them in one `combine`, keeping every node in the `compose` graph a real
  resource and every reference typed.
- `core` gains one small, general, `aws-cdk-lib`-free export. It composes with
  the existing `Ref` machinery — no seam changes, no new `Resolvable` variant,
  and it is available to every builder package at once.
- Direct API Gateway → AWS-service integrations are expressible today with
  explicit, visible roles and consumer-side grants — closing
  [#270](https://github.com/laazyj/composureCDK/issues/270) without the
  auto-role builder that [#276](https://github.com/laazyj/composureCDK/pull/276)
  proposed.
- The single-reference `ref` remains the default and the common case; `combine`
  is the deliberate exception for multi-sibling assembly, documented as such so
  it is not reached for when a plain `ref` would do.

## Alternatives considered

- **A fake `Lifecycle` that merges two refs.** Rejected: it invents a graph node
  that models no resource and relies on untyped context casts — the anti-pattern
  this ADR removes.
- **A dedicated AWS-service integration builder that owns its role
  ([#276](https://github.com/laazyj/composureCDK/pull/276)).** Rejected: it adds
  role auto-creation `aws-cdk-lib` does not provide, obscuring design CDK keeps
  explicit, and solves only the apigateway instance of a general problem.
- **Extending `ref` to accept multiple component keys.** Rejected: it overloads
  the single-reference primitive and muddies its type. A separate combinator
  keeps `ref` simple and names the multi-sibling case explicitly.
