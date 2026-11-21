# ADR 0021: Alarm keys are typed on the result, not accumulated by the builder

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Every builder that ships alarms returned them as `alarms: Record<string, Alarm>`. A misspelled or renamed key still compiled, and the value was `undefined` at synth. That matters once alarms are wired between components, for example as the members of a composite alarm, where an `undefined` member fails at synth with an error that does not point at the typo ([#796](https://github.com/laazyj/composureCDK/issues/796)).

Two places can carry the keys: the builder's type, accumulating each `addAlarm(key, …)` as a literal, or the result type a consumer names when reading alarms.

Accumulating on the builder was spiked, and it fails for two reasons:

- **`IBuilder` / `ITaggedBuilder` erase a method's own type parameters.** The mapped type reads a chainable method as `(...args: infer A) => T`, so `addAlarm<K>` comes out with `K = string`. Carrying `K` through core would mean special-casing `addAlarm` in `IBuilder` and in every decorator alias ([ADR-0006](0006-decorator-builder-pattern.md)), coupling core to alarms.
- **The per-class workaround is fragile.** Typing `addAlarm` to return the builder type, rather than `this`, keeps it out of the rewrite, and works for a class with one type parameter. As soon as a second parameter flows into the return type, as the SQS queue role does, TypeScript's variance measurement and permissive instantiation recurse through the same mapped type and fail with TS2589 / TS2615. Explicit variance annotations fixed one spike and not the real builder. A pattern meant for every alarm-shipping builder cannot depend on that.

It would also not reach the main consumer. A `ref` callback types its argument by annotation (`(r: QueueBuilderResult) => …`), not by inference from the builder it names, so builder-side keys never get there.

## Decision

1. **`@composurecdk/cloudwatch` exports `AlarmsOf<Recommended>`**, defined as `Partial<Record<Recommended, Alarm>>`. Recommended keys are optional. The user can disable a recommended alarm, its creation can depend on configuration (a timeout, an event source), and `resolveAlarmThresholdBasis` can skip it when its basis is an unresolved token.
2. **Each package declares the union of recommended keys it creates** (`QueueAlarmKey`, `FunctionAlarmKey`). The union is not derived from the config type, because the two differ: Lambda's `eventSourceDroppedEvents` config creates `${source}DroppedEvents` alarms. Derived keys are template-literal patterns.
3. **Custom keys are added from outside the result type, by a modifier.** `@composurecdk/cloudwatch` exports `WithCustomAlarms<Result, Custom>`, defined as `Result & { alarms: Record<Custom, Alarm> }`; an intersection of results intersects their `alarms`. Custom keys are required, because `addAlarm` always creates its alarm. A consumer names the custom keys it reads: `(r: WithCustomAlarms<QueueBuilderResult, "backlogDepth">) => r.alarms.backlogDepth`. The result type (`alarms: AlarmsOf<QueueAlarmKey>`) takes no type parameter for them. A parameter would claim the result's one generic position for its `alarms` alone, and a later need to bound another property would have nowhere to go; a modifier leaves the position free, and modifiers compose.
4. **The builder's own `build()` returns the result with `string`** (`Lifecycle<WithCustomAlarms<QueueBuilderResult, string>>`). A builder cannot know its custom keys at the type level, so a direct `build()` or an inferred `compose()` output accepts any key, as before. Strictness applies where a result type is named, which is where alarms are read across components.

## Consequences

- With a named result type, a misspelled recommended key, or a custom key that was not declared, is a compile error. A recommended alarm reads as `Alarm | undefined`, so the disabled case has to be handled rather than reaching synth as `undefined`.
- Declared custom keys are not checked against the builder's `addAlarm` calls. Renaming an alarm in `addAlarm` without updating the annotation still compiles. This is the gap that builder-side accumulation would have closed. Revisit it if `IBuilder` gains a way to preserve method type parameters.
- Narrowing a result's `alarms` is source-breaking for code that names the result type and reads a custom key, or that indexes it with an arbitrary string. That code has to declare the key with `WithCustomAlarms`, or use `WithCustomAlarms<Result, string>`. A direct `build()` result, typed with `string`, is not assignable to a narrower `WithCustomAlarms<Result, "key">`, because an index signature does not supply a required property. The narrow form is for annotating a `ref` callback, whose argument is not checked against the component it names.
- Converting a package means declaring its key union, typing the result's `alarms` with `AlarmsOf` and typing `build()` with `WithCustomAlarms<…, string>`. No builder class or factory changes. Packages convert one at a time, and an unconverted result keeps `Record<string, Alarm>`.
