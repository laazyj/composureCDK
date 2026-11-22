# composurecdk/error-name-matches-class

Flags an `Error` subclass that does not set `name` to its class name, and an exported one whose TSDoc does not tell consumers to catch it by `name`.

- **Preset:** `internal` (`error`)

## Why

Every composureCDK package ships both ESM and CommonJS builds, and both copies can load in one process ([ADR-0007](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0007-dual-esm-cjs-publishing.md)). A consumer who catches one of the library's errors with `instanceof` can then miss an error thrown by the other copy. So the library's errors are caught by `name` ([Errors](https://github.com/laazyj/composureCDK/blob/main/docs/architecture.md#errors)), which only works if each one sets `name` to its class name and its TSDoc says so. A subclass that forgets inherits its parent's `name`, and a consumer matching on the subclass never sees it.

It is an `internal` rule because its TSDoc check enforces composureCDK's own wording for the catch-by-`name` note, which would misfire on another library's docs. The `name` half is sound for any dual-published library, and could move to `dualPublishing` in a major.

## ❌ Incorrect

```ts
/** Thrown when a widget is wrong. */
export class WidgetError extends Error {
  constructor(message: string) {
    super(message);
  }
}
```

## ✅ Correct

```ts
/**
 * Thrown when a widget is wrong.
 *
 * Catch this by `name`, not `instanceof`: under the dual ESM/CJS build
 * (ADR-0007) the copy that threw may not be the copy the catching module
 * imported, and `instanceof` is realm-bound.
 */
export class WidgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WidgetError";
  }
}
```

## How it works

Syntactic. A named class whose `extends` clause is the identifier `Error`, or any identifier ending in `Error`, must either assign `this.name = "<ClassName>"` in its constructor or declare a `name = "<ClassName>"` field, with a string literal equal to its own name. If the class is exported (`export class` or `export default class`), the block comment before the export must contain ``by `name` ``.

## Known gaps

A superclass reached through a member expression (`extends errors.Base`) or an import alias not ending in `Error` is not recognised, and a class exported later by `export { WidgetError }` is not checked for the note.
