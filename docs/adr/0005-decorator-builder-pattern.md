# ADR 0005: Decorator pattern for adding cross-cutting builder features

- **Status:** Accepted
- **Date:** 2026-05-05

## Context

`@composurecdk/core` exports `Builder<Props, T>(constructor)` and the `IBuilder<Props, T>` mapped type. Together they provide a deliberately minimal, CDK-agnostic builder primitive: a Proxy that intercepts prop setters and chainable methods, with no opinion about what the wrapped class does. Every builder package in the library — `s3`, `lambda`, `apigateway`, `ec2`, `route53`, etc. — uses this primitive directly to build a fluent surface around a CDK construct.

Some features are intrinsically cross-cutting: they apply to **every** builder rather than to one resource type. Examples that have come up or are likely to:

- **Tagging** — every taggable construct should be reachable from a single `.tag(key, value)` / `.tags({...})` call on the builder, with the tag landing on the primary construct and on every sibling the builder creates (auto-managed log groups, access-log buckets, alarms maps).
- **Future candidates** — uniform `.timeout()` / `.retries()` for build-time IAM wiring waits, structured logging or telemetry hooks at `build()` time, a `.dryRun()` switch that returns a result without committing CDK constructs, removal-policy defaults, etc.

When tagging — the first cross-cutting feature — was being designed (issue #66), three implementation paths surfaced:

1. **Per-builder methods.** Each of ~30 builder classes declares its own `.tag()`, its own `#tags` field, and its own application call in `build()`. Roughly 10 lines × 30 builders = ~300 lines of duplicated mechanics. High drift risk: any new builder must remember to add the methods, and any change to the validator or accumulator semantics must be applied in every package.
2. **Modify `core.Builder()`** to special-case `.tag()` and `.tags()` (and any future cross-cutting method). Eliminates duplication, but couples `core` to `aws-cdk-lib`'s `Tags` API and bloats the proxy with feature-specific name handling. The boundary `core` keeps — CDK-agnostic, builder primitive only — was a deliberate decision and we shouldn't relax it for one feature, let alone for an open-ended list of future features.
3. **A decorator factory that wraps `Builder()`.** A new factory in a CDK-aware package returns a decorated proxy that intercepts the cross-cutting method names before delegating to the inner core proxy, applies behaviour at `build()` time, and re-wraps chainable returns so the decorator surface stays reachable.

Path (3) is the standard decorator/composite pattern: the decorator implements the same interface as the base, adds behaviour, and forwards everything else. CDK-side TypeScript developers will recognise it from the way Aspects layer onto constructs without changing them, and from the way `@composurecdk/cloudformation` already layers `outputs()` and `StackBuilder` on top of `core`.

## Decision

**Cross-cutting builder features are added via decorator factories that wrap `Builder()` from `@composurecdk/core`. Each builder factory in the library opts into the decoration by calling the decorator instead of the bare core API. `core` itself stays minimal and CDK-agnostic.**

Concrete shape:

- **Naming.** A decorator is `<feature>Builder<Props, T>(constructor)` (e.g. `taggedBuilder`), accompanied by a paired type alias `I<Feature>Builder<Props, T>` (e.g. `ITaggedBuilder`). Both exports live in the package most natural for the feature — typically `@composurecdk/cloudformation` for CDK-aware features.
- **Type shape.** `I<Feature>Builder<Props, T>` re-derives the `IBuilder<Props, T>` mapped type but rewrites every chainable return type (prop setters and methods returning `T`) to `I<Feature>Builder<Props, T>` so the decorator's added methods stay reachable after any chained call.
- **Runtime shape.** The decorator returns an outer `Proxy` wrapping the proxy returned by `Builder()`. The outer proxy:
  - Intercepts the feature's method names directly.
  - Wraps `build()` to invoke the inner build then apply the feature.
  - Passes everything else through to the inner proxy. Methods that return the inner proxy (chainable setters) are re-wrapped to return the outer proxy so the chain preserves the decorator's type.
- **Opt-in via factory choice.** Each builder factory calls `<feature>Builder<Props, T>(C)` instead of `Builder<Props, T>(C)`. Authoring a builder that does not opt into decoration is supported — call `Builder()` directly and consumers get the bare interface.
- **Lint enforcement.** A `no-restricted-imports` ESLint rule under `packages/*/src/**` bans direct imports of `Builder` and `IBuilder` from `@composurecdk/core`, with an explicit exception for the decorator file itself. New builders authored in the library hit a save-time error pointing them at the decorator. This makes "every library builder is decorated" an enforced invariant rather than a convention.
- **Decorators compose.** Two decorators wrapping the same base builder produce a stacked proxy. Order matters for type composition — the outermost factory determines the type the user sees — but runtime is order-agnostic for non-conflicting features. We expect the number of decorators to stay small; if it grows, the decorator chain becomes a candidate for a generalised composition helper.

The first decorator, `taggedBuilder`, lives in `@composurecdk/cloudformation`. It:

- Adds `.tag(key, value)` and `.tags({...})` that validate inputs at call time and accumulate entries in an insertion-ordered map (last-wins on duplicate, with `process.emitWarning` so overrides are visible).
- Wraps `build()` to walk the result one level deep and call `Tags.of(...).add(...)` on every reachable `IConstruct` (top-level fields plus values inside `Record<string, IConstruct>` fields).
- Synchronises the accumulator onto the wrapped instance via a symbol-keyed field, so builder code that creates constructs outside `build()` (currently only `StackBuilder.toScopeFactory()`) can read the same tag state.

Behaviour-specific details — validator regex, walker semantics, the override-warning policy — are documentation/feature concerns and live with the decorator's source and the [Tagging section of `extensions.md`](../extensions.md#tagging), not in this ADR. This ADR is about the pattern, not its first instance.

## Consequences

- **`@composurecdk/core` stays minimal.** It keeps `Builder()` and `IBuilder<Props, T>` exactly as designed, free of CDK dependencies and free of feature-specific code. Non-CDK consumers can use `core` directly.
- **Cross-cutting features ship in CDK-aware packages.** A feature that needs `aws-cdk-lib` (Tags, Aspects, Stack APIs) lives in `@composurecdk/cloudformation` or another domain package, depends on `core`, and is consumed by every builder package as a peer dependency. The library's existing dependency direction (builder packages → CDK-aware extension packages → `core`) is preserved.
- **Adding a new cross-cutting feature is a single-package change plus a one-line factory swap per builder.** No per-builder method boilerplate. The decorator owns the method-name interception, the validator, the accumulator, and the application step.
- **The lint rule guarantees future builders pick up the decorator by default.** Authoring `Builder<>(C)` directly in `packages/*/src/**` fails lint with a message pointing at the decorator. Custom builders authored outside the library can still bypass the decorator by importing `Builder` directly — the rule is library-scoped.
- **Decorator type composition has a constraint.** Stacking decorators requires each `I<Feature>Builder` to substitute its own return type for chainable members. Two decorators `A` and `B` stacked as `B(A(C))` give `IBBuilder<Props, T>`; chained calls return `IBBuilder`, but `IABuilder`-specific methods are still reachable because `IBBuilder extends IABuilder` structurally. The constraint is: each decorator's type must be a structural superset of `IBuilder`. The pattern documented above satisfies this.
- **Discoverability matches CDK's idiom.** `Tags.of(scope)`, `Aspects.of(scope)`, `RemovalPolicy.of(scope)` — CDK uses `<Feature>.of(scope)` for cross-cutting concerns. `<feature>Builder(constructor)` reads similarly: the developer sees a CDK-style indirection that says "this is a cross-cutting feature applied via a wrapper."
- **`core.Builder` and `core.IBuilder` remain exported.** They are public API for anyone authoring custom builders outside the library, and they are the substrate the decorators wrap. The lint rule restricts library code, not consumers.
- **Trade-off accepted.** Each builder package gains a peer dependency on the package that hosts the decorator (`@composurecdk/cloudformation` for `taggedBuilder`). This is the cost of pushing CDK-aware machinery out of `core`. We considered placing decorators in a dedicated `@composurecdk/builder` package to keep `cloudformation` lean, but the only decorator today is tightly coupled to `Tags.of` from `aws-cdk-lib`, which `cloudformation` already depends on. Revisit if more decorators land in different domain packages.

## Alternatives considered

- **Modify `core.Builder()` to special-case cross-cutting method names.** Rejected: couples `core` to `aws-cdk-lib`, and the proxy gains feature-specific code that grows with each new feature. The whole point of `core` is to be the smallest possible primitive.
- **Per-builder `.tag()` / `.tags()` methods on each class.** Rejected: ~300 lines of duplicated mechanics across 30 builders, with drift risk on every change to the cross-cutting concern.
- **A mixin or base class.** Rejected: the library deliberately uses interfaces, not inheritance ([`architecture.md`](../architecture.md)). A base class would force builders to extend a framework class, defeating the "any object with a `build` method" composability.
- **Aspect-based application without a builder-level surface.** Rejected for the tagging case because authors need a place to write the tag declaration that sits next to the resource it targets — `.afterBuild((scope) => Tags.of(scope.node.find...).add(...))` is exactly the friction this ADR removes. Aspects remain the right tool for system-wide concerns; `tags({ system: {...} })` covers that case via an `afterBuild` hook.
