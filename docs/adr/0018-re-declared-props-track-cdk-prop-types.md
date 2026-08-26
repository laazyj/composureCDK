# ADR 0018: Re-declared builder props take their type from the CDK prop

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Every builder's props interface is the CDK props type with a few keys lifted
out and re-declared:

```ts
export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
  masterKey?: Resolvable<IKey>;
}
```

Everything inside the `Omit` tracks the consumer's installed `aws-cdk-lib` —
that is the whole point of extending CDK's own type rather than restating it.
The re-declared key does not. It freezes at whatever interface was current when
it was written, and there is nothing to tell us when that stops being true.

CDK's prop types move. The current instance is the
[reference-interface](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms.IKeyRef.html)
migration — `IKey` → `IKeyRef`, `IEventBus` → `IEventBusRef`,
`ICertificate` → `ICertificateRef` — rolling out prop by prop since 2.215.0.
When a prop we re-declare moves, our pinned spelling silently starts
**rejecting values the underlying CDK accepts**: the builder's public API
narrows relative to the construct it wraps, and the consumer sees
"your builder rejects the value CDK told me to pass".

Nothing in the pipeline catches it. `cdk-floors enforce` ([ADR-0008](0008-aws-cdk-lib-version-floors.md))
runs the unit suites, and vitest does not typecheck. `build` and `typecheck`
run against the latest `aws-cdk-lib` devDependency, where a narrowed prop still
compiles — it is narrower, not wrong. `attw` / `publint` check emission and
packaging, not assignability. The failure surfaces only in a consumer's own
`tsc`, which is the last place we want to find it.

Two instances shipped and went unnoticed for roughly seven months (#401
`events.eventBus`, #402 `cloudfront.certificate`). Three more were fixed
reactively (#387, #389). The remaining re-declarations are correct today and
will break one at a time as AWS works through the migration.

Raising the floors and naming the new `*Ref` interfaces was rejected in #387:
`FunctionProps.environmentEncryption` would have cost lambda consumers ten
months of CDK releases in order to accept a type no caller in this library
produces — and it only defers the problem to the next migration.

## Decision

**A prop re-declared only to widen it to `Resolvable` takes its inner type from
the CDK prop, as an inline indexed access.**

```ts
export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
  masterKey?: Resolvable<NonNullable<TopicProps["masterKey"]>>;
}
```

The prop now accepts exactly what the consumer's `aws-cdk-lib` accepts, in
either direction, at every floor — because it _is_ that type. `NonNullable`
strips the optionality CDK's own `?` carries, so the re-declaration re-states
it rather than nesting `undefined` inside the `Resolvable`.

This applies wherever the builder re-declares a lifted CDK prop — in the props
interface, or in the hand-written setter that stands in for a prop lifted out
of the interface entirely (`.vpc()`, `.destinationBucket()`).

### The indexed access must stay inline

Never introduce a named alias for it:

```ts
type MasterKey = NonNullable<TopicProps["masterKey"]>; // ✗
```

A named alias puts an unnameable type into the emitted `IBuilder` mapped type
and reintroduces [ADR-0001](0001-builder-type-emission.md)'s TS2883 for
consumers writing `createSystem()`. The same reasoning rules out a shared
`ResolvableProp<T, K>` helper in `@composurecdk/core`: it would mint public API
for a spelling three tokens shorter, and carry the emission trap to every call
site that aliased it.

### What the rule does not cover

- **A prop re-declared to change its _shape_.** The builder's own type is the
  point, and CDK's is not part of it: `s3` `serverAccessLogsBucket`/`Prefix` →
  `ServerAccessLogsConfig`, `ec2` `flowLogs` → `FlowLogsConfig`, `route53`
  `queryLogsLogGroupArn` → `QueryLoggingConfig`, `cloudfront`
  `functionAssociations` → `functions`.
- **A prop re-declared only to change its optionality**, where the builder
  supplies a default — the dynamodb event source's `startingPosition`, the
  bucket deployment's `sources`.
- **`any`-typed props.** `custom-resources` mirrors `AwsSdkCall.parameters`,
  which is `any` upstream; tracking it would yield `Resolvable<any>` and
  destroy the type safety the mirror exists to add.
- **Primitives.** `route53` `values` is `string[]` and will never migrate; an
  indexed access buys nothing and costs legibility.
- **A widened union that adds an arm of the builder's own.** The CDK arm should
  still track (`Resolvable<string | NonNullable<…["delegationRole"]>>`), but the
  added arm has no CDK prop to read from and stays named.

### Enforcement

`@composurecdk/eslint-plugin`'s `redeclared-prop-must-track-cdk-type` flags a
`Resolvable<T>` whose `T` is a type imported from `aws-cdk-lib`, on a property
whose name appears in the `Omit<…>` of the same interface's `extends` clause.
The check is syntactic — no type resolution — so it works in the current flat
config and fires at authoring time. Without it the sweep decays: nothing else
stops the next author writing `Resolvable<IKey>`, and it will still compile.

Each swept package also carries a whole-interface assignability guard in its
unit suite:

```ts
const props: TopicBuilderProps = undefined as unknown as TopicProps;
```

Structural assignment ignores the props the builder replaces outright, so those
need no exemption — and a prop that is merely widened must never be given one.
The guard is checked by `tsc`, not by vitest, so it belongs to `typecheck`
rather than `test`.

## Consequences

- **The narrowing class of bug is closed by construction.** A future
  `IQueue` → `IQueueRef` migration reaches every swept prop with no change on
  our side, at every supported floor, in both directions.
- **`*BuilderProps` is public API ([ADR-0001](0001-builder-type-emission.md)),
  so this is a semver-relevant change** — anyone referencing
  `FunctionBuilderProps["environmentEncryption"]` sees a different type. It only
  ever widens what is accepted, and it landed pre-1.0, but it landed across
  every builder package.
- **Hover text and generated docs are less literal.** The prop reads as an
  indexed access rather than a name. Package READMEs keep describing it as
  `Resolvable<IKey>`, which is what a user passes and what the examples show;
  `@composurecdk/kms`'s README says so explicitly for the key-consuming props.
- **The per-package floor notes in `cdk-floors.json` are subsumed.** The notes
  added for `logs`, `lambda`, `neptune`, `events` and `cloudfront` warned
  against "simplifying" the indexed access back to an interface name. That
  warning is now a lint rule and an ADR; the notes stay as version-specific
  context but are no longer the only thing standing between the codebase and a
  regression.
- **Type-level assertions per package (#388) are not needed.** They would detect
  the drift and fail `typecheck`, but leave the pinned type in place — turning a
  silent bug into a build failure plus a manual fix. Tracking the prop removes
  the fix.
