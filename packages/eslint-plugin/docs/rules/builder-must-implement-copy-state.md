# composurecdk/builder-must-implement-copy-state

Flags a builder class holding private state with no `[COPY_STATE]` hook.

- **Severity in `recommended`:** `error`
- **Decision:** [ADR-0005](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0005-builder-copy.md)

## Why

`.copy()` shallow-clones `props`. Anything a builder keeps _outside_ `props` — private fields — is not carried across unless `[COPY_STATE]` says so. Without the hook, `.copy()` silently drops that state, breaking both variant authoring and strategy hand-off, and it fails quietly: the copy looks fine and behaves differently.

[ADR-0005](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0005-builder-copy.md) has the design.

## ❌ Incorrect

```ts
class BucketBuilderImpl {
  #alarms: AlarmDefinition[] = [];
  // no [COPY_STATE] — `.copy()` returns a builder with no alarms
}
```

## ✅ Correct

```ts
class BucketBuilderImpl {
  #alarms: AlarmDefinition[] = [];

  [COPY_STATE](target: this): void {
    target.#alarms = [...this.#alarms];
  }
}
```

## Existence, not correctness

The rule checks only that the hook is **present**. A hook copying three of five fields passes. The companion test helper `assertCopyPreservesState` from `@composurecdk/core/testing` closes that gap on the test side — the two are meant to be used together.

## Per-field opt-out

Annotate a field to exempt it, e.g. for cache-shaped state regenerated on each build. The justification after `--` is required:

```ts
// @copy-state: ignore -- memoised per build, regenerated on the clone
#resolvedArn?: string;
```

## How it works

Syntactic. The rule identifies builder classes as those passed as the first argument to `Builder()` or `taggedBuilder()`, then checks for private fields against the presence of a `[COPY_STATE]` member.
