import type { Linter } from "eslint";
import { preset } from "./preset.js";

/**
 * The consumer preset — the rules that hold for anyone writing a builder
 * against `@composurecdk/core`, whatever their project's shape.
 *
 * Nothing here is conditional on this repo's conventions (those live in
 * `internal`) or on the format the project itself publishes (`dualPublishing`).
 * Note which side `no-realm-bound-instanceof` falls on: its premise is that the
 * *imported* class can load twice, which is a property of the dependency, so it
 * binds a single-format consumer of a dual-published package too.
 *
 * Spread into a config object scoped to the sources implementing builders; the
 * preset registers the plugin itself:
 *
 * ```js
 * { files: ["src/**\/*.ts"], ...composurecdk.configs.recommended }
 * ```
 *
 * Its membership, rule messages and severities are public API — see the
 * README's versioning section before changing any of them.
 */
export const recommended: Linter.Config = preset([
  "builder-must-implement-copy-state",
  "lifecycle-build-context-required",
  "lifecycle-build-must-forward-context",
  "no-realm-bound-instanceof",
]);
