# composurecdk/redeclared-prop-must-track-cdk-type

Flags a re-declared CDK prop that pins a named CDK interface inside `Resolvable<…>` instead of reading the type from CDK's own prop.

- **Severity in `recommended`:** `error`
- **Decision:** [ADR-0018](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0018-re-declared-props-track-cdk-prop-types.md)

## Why

A builder's props interface is `Omit<CdkProps, K>` plus a re-declaration of each lifted key. Everything inside the `Omit` tracks the consumer's installed `aws-cdk-lib` — that is the point of extending CDK's own type. A re-declared key spelled `Resolvable<IKey>` does not: it freezes at whatever interface was current when it was written, so when CDK widens that prop the builder silently starts **rejecting values the wrapped construct accepts**.

Nothing else catches it. The suites do not typecheck, and `build` runs against the latest CDK, where a narrowed prop still compiles — it is narrower, not wrong. The failure surfaces in a consumer's own `tsc`.

[ADR-0018](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0018-re-declared-props-track-cdk-prop-types.md) has the full case, including the two instances that shipped unnoticed for seven months and why raising the version floors was rejected instead.

## ❌ Incorrect

```ts
import { type IKey } from "aws-cdk-lib/aws-kms";
import { type TopicProps } from "aws-cdk-lib/aws-sns";

export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
  masterKey?: Resolvable<IKey>;
}
```

## ✅ Correct

```ts
import { type TopicProps } from "aws-cdk-lib/aws-sns";

export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
  masterKey?: Resolvable<NonNullable<TopicProps["masterKey"]>>;
}
```

The prop now accepts exactly what the consumer's `aws-cdk-lib` accepts, at every floor, because it _is_ that type.

**Keep the indexed access inline.** Extracting it to a named alias puts an unnameable type into the emitted builder type and reintroduces [ADR-0001](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0001-builder-type-emission.md)'s TS2883.

## Not flagged

Each is a deliberate exclusion in ADR-0018:

| Shape                                                         | Why it is allowed                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Resolvable<string[]>`, `Resolvable<Record<string, unknown>>` | Primitives and `any`-shaped types resolve to no CDK import.                                                     |
| `Resolvable<string \| Foo["bar"]>`                            | A widened union — the arm the builder adds has no CDK prop to read from. Only a bare type reference is flagged. |
| A shape-replacing re-declaration                              | The builder's own type is the point; it is not a `Resolvable` of a CDK interface.                               |

## Known gaps

Both are covered by ADR-0018 and by review rather than by this rule:

- A prop re-declared in a **separate interface** that the props interface mixes in (`@composurecdk/sqs`'s `QueueBuilderExtensionProps`) has no `Omit` of its own to key on.
- A **hand-written setter** standing in for a lifted prop is a class method, not a property signature.

## How it works

Purely syntactic — no type resolution, so it runs in the flat config and fires at authoring time. The rule looks for a property whose name appears in the `Omit<…>` of its own interface's `extends` clause, and whose `Resolvable<…>` argument is a bare type reference imported from `aws-cdk-lib` or `@aws-cdk/*`.
