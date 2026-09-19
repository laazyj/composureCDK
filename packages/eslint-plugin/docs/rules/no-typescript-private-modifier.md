# composurecdk/no-typescript-private-modifier

Flags the TypeScript `private` modifier on a class member, in favour of an ECMAScript `#` private field.

- **Preset:** `libraryAuthor` (`error`)
- **Decision:** [ADR-0001](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0001-builder-type-emission.md)

## Why

The two kinds of privacy look interchangeable and are not, once a class is generic over its own members.

A TypeScript `private` member is still **part of the type**. It appears in `keyof T`, so it survives into any mapped type built from the class — and from there into the emitted `.d.ts`, where a consumer's compiler meets a name it cannot refer to and reports **TS4094**. The error surfaces in the consumer's build, not in the one that produced the declaration.

An ECMAScript `#field` is not part of the type at all, so nothing downstream can trip over it.

Builders are the case that forces this, since a builder's public type is derived from its class by a mapped type — but the hazard belongs to any class whose type is transformed rather than written out by hand.

## ❌ Incorrect

```ts
class BucketBuilderImpl {
  private props: BucketProps = {};

  private clone(): this {
    return this;
  }
}

class Component {
  constructor(private readonly scope: IConstruct) {}
}
```

## ✅ Correct

```ts
class BucketBuilderImpl {
  #props: BucketProps = {};

  #clone(): this {
    return this;
  }
}

class Component {
  readonly #scope: IConstruct;

  constructor(scope: IConstruct) {
    this.#scope = scope;
  }
}
```

A parameter property cannot be `#private` — there is no syntax for it — so the field is declared on the class and assigned in the constructor body.

## Not flagged

| Shape                            | Why it is allowed                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `private constructor() {}`       | `#constructor` is not valid syntax, so there is nothing to prefer. Private constructors stay available for factory-only classes. |
| `protected` and `public` members | Deliberately part of the type; this rule is only about privacy that leaks.                                                       |
| `constructor(readonly scope: T)` | A parameter property with no accessibility modifier. It is public by design.                                                     |

## How it works

Three syntactic selectors — a `private` property, a `private` method that is not a constructor, and a `private` parameter property. No type information, so it runs in a flat config and reports as you type.

## History

`private accessor x` was not caught while this was a config: `accessor` fields parse as a distinct node that none of the three selectors matched, though the `private` on one reaches `keyof T` exactly as a plain field's does. The rule closes that hole, so it flags slightly more than the selectors did.

This shipped as three `no-restricted-syntax` selectors before becoming a rule. That was fine while the preset was private to one repo and fatal once published: flat config **replaces** rule options rather than merging them, so a consumer configuring `no-restricted-syntax` for their own purposes would silently drop all three selectors — no error, no warning. A named rule composes instead of colliding.
