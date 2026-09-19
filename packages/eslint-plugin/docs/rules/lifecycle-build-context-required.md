# composurecdk/lifecycle-build-context-required

Flags a `Lifecycle` class that uses `Resolvable<…>` but whose `build` method takes no `context` parameter.

- **Preset:** `recommended` (`error`)

## Why

A builder holding a `Resolvable<…>` accepts refs at configuration time. Resolving one at build time needs the context — `resolve(value, context)`. With no `context` parameter the call receives `undefined`, and the ref throws "cannot be resolved" at synth.

This rule checks the **declaration**. Its call-site counterpart, [`lifecycle-build-must-forward-context`](lifecycle-build-must-forward-context.md), checks that a builder which delegates actually passes its context on — having the parameter is not enough.

## ❌ Incorrect

```ts
class TopicBuilderImpl implements Lifecycle<Topic> {
  #props: { masterKey?: Resolvable<IKey> } = {};

  build(scope: IConstruct, id: string): Topic {
    // no `context` — resolving `masterKey` here cannot work
  }
}
```

## ✅ Correct

```ts
class TopicBuilderImpl implements Lifecycle<Topic> {
  #props: { masterKey?: Resolvable<IKey> } = {};

  build(scope: IConstruct, id: string, context?: BuildContext): Topic {
    const masterKey = resolve(this.#props.masterKey, context);
  }
}
```

## How it works

Syntactic. The rule keys on the identifier `Resolvable` appearing in the class body — a name unique to this codebase. Keying on `resolve(` instead would produce false positives on `Promise.resolve` and friends.
