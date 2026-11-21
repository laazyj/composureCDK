# @composurecdk/core/testing

Test helpers for [builder authors](../../../docs/architecture.md#public-api) writing their own builders on ComposureCDK. Each one checks a contract every builder must keep. This subpath is public API.

## assertCopyPreservesState

Checks a builder's [`[COPY_STATE]`](../../../docs/adr/0005-builder-copy.md) hook: that `.copy()` returns an independent builder that keeps the state a builder holds outside `props`, such as custom alarms or subscriptions.

```ts
import { App, Stack } from "aws-cdk-lib";
import { assertCopyPreservesState } from "@composurecdk/core/testing";

assertCopyPreservesState({
  factory: () => createWidgetBuilder().name("example"),
  configure: (b) => b.addAlarm("First", (a) => a /* … */),
  mutate: (b) => b.addAlarm("Second", (a) => a /* … */),
  build: (b) => b.build(new Stack(new App(), "S"), "Widget"),
  inspect: (r) => Object.keys(r.alarms).sort(),
});
```

| Argument    | Purpose                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `factory`   | Returns a fresh, unconfigured builder. Called twice.                                      |
| `configure` | Applies the state under test.                                                             |
| `mutate`    | Applied to the original after the copy is taken. Must change something `inspect` can see. |
| `build`     | Builds the builder. Called three times, so create a new scope on each call.               |
| `inspect`   | Extracts the part of the build result that depends on the state under test.               |

It throws if the copy lost state that `configure` set, or if `mutate` changed nothing `inspect` can see, so the test could not detect a leak. The function's TSDoc gives the full sequence.

The [`builder-must-implement-copy-state`](../../eslint-plugin/docs/rules/builder-must-implement-copy-state.md) lint rule checks that a builder holding private state has a `[COPY_STATE]` hook; this helper checks that the hook is correct.
