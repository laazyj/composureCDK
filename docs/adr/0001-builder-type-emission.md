# ADR 0001: Builder type emission — export `*BuilderProps`, use `#` private fields

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

`IBuilder<Props, T>` in `@composurecdk/core` is a mapped type:

```ts
export type IBuilder<Props extends object, T> = {
  [K in keyof Props]-?: ((arg: Props[K]) => IBuilder<Props, T>) & (() => Props[K]);
} & {
  [K in keyof T]: T[K] extends (...args: infer A) => T ? (...args: A) => IBuilder<Props, T> : T[K];
};
```

The two halves of the intersection reference `Props` and `T` structurally via `keyof`. When a consumer writes a function whose inferred return type transitively embeds an `IBuilder<…>` (the canonical case is a `createSystem()` that returns `compose({ site, cdn, … }, …)`), TypeScript has to emit a description of that type into the consumer's `.d.ts`. Two errors can fire:

- **TS2883** — "inferred type cannot be named without a reference to '…BuilderProps'". TypeScript has to name `BucketBuilderProps`, `DistributionBuilderProps`, etc. when resolving `keyof Props`. If those types are not re-exported from the package barrel, the consumer has no import path for them.
- **TS4094** — "Property '…' of exported anonymous class type may not be private or protected". The builder class is never exported (consumers get it only through `I*Builder`), so it is anonymous at the emission boundary. The TypeScript `private` modifier still puts fields in `keyof T`, so they are included in the emitted mapped type — and private members of an anonymous class cannot be emitted.

Both errors shipped in 0.3.6 and broke real consumers. They were latent in 0.3.5 for the same reasons; most consumers had not yet written `createSystem`-shaped functions that forced the inference.

A previous decision (ADR predecessors; commit `1fcd0dc`, shipped in 0.3.1) deliberately withheld `*BuilderProps` from barrels, reasoning that configuring builders through a props object isn't a supported use case and exposing the type would invite it. That rationale is sound but the cost — unemittable consumer declarations — turned out to dominate.

## Decision

1. **Every `*BuilderProps` type is re-exported from its package barrel** (`packages/*/src/index.ts`), alongside `create*Builder`, `I*Builder`, and `*BuilderResult`. The type is named at the barrel so consumers' `.d.ts` emission can reference it.

2. **Builder classes use ECMAScript private fields (`#field`) rather than the TypeScript `private` modifier.** ECMAScript `#` fields do not appear in `keyof T`, so they are invisible to the `IBuilder<Props, T>` mapped type and to emitted declarations. The only permitted use of `private` is on a constructor (there is no `#constructor` syntax).

3. **Both rules are enforced by ESLint.** `eslint.config.mjs` uses `no-restricted-syntax` scoped to `packages/*/src/**/*.ts` to reject `PropertyDefinition[accessibility='private']`, `MethodDefinition[accessibility='private'][kind!='constructor']`, and `TSParameterProperty[accessibility='private']`. The barrel re-export restriction from 0.3.1 is removed.

## Consequences

- Consumers can write `function createSystem() { return compose({ … }, { … }); }` under `declaration: true` without annotating a return type. This is the dominant ergonomic the library exists to enable.
- `*BuilderProps` is in the public API. New builders must treat changes to it as semver-relevant, even though the fluent API is still the expected way to configure a builder. Documentation should continue to steer users toward the fluent API.
- Builder authors must declare private state with `#field` (and assign in the constructor body if they previously used a parameter property). The lint rule catches the common mistake at save-time.
- Parameter properties with `private` (e.g., `constructor(private readonly foo: T) {}`) are no longer permitted in builder packages. Declare the field separately with `readonly #field` and assign it inside the constructor.
- `private constructor` remains legal and is used by `Ref` in `@composurecdk/core` to prevent external instantiation.
