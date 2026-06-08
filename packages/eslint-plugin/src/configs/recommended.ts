import type { Linter } from "eslint";

/**
 * Rules that encode ComposureCDK architectural invariants. Apply to
 * `packages/* /src/**\/*.ts` (library source) — the rules are written
 * with that scope in mind. File-level overrides (e.g. for the
 * `tagged-builder.ts` implementation itself) belong in the consumer's
 * config, not here.
 */
export const recommended: Linter.Config = {
  rules: {
    "composurecdk/builder-must-be-tagged": "error",
    "composurecdk/builder-must-implement-copy-state": "error",
    "composurecdk/constraint-metadata-required": "error",
    "composurecdk/lifecycle-build-context-required": "error",
    "composurecdk/no-cdk-api-above-floor": "error",
    "composurecdk/no-cjs-incompatible-syntax": "error",
    // Bans the TypeScript `private` modifier in favour of ECMAScript private
    // fields (#field). TS `private` members appear in `keyof T` and leak into
    // emitted .d.ts files via mapped types (builder types), producing TS4094
    // errors downstream. Kept as `no-restricted-syntax` rather than a custom
    // rule because the selectors are mechanical and cover three closely
    // related cases that share a single rationale.
    "no-restricted-syntax": [
      "error",
      {
        selector: "PropertyDefinition[accessibility='private']",
        message:
          "Use ECMAScript private fields (#field) instead of the TypeScript `private` modifier. TS `private` members appear in `keyof T` and leak into emitted .d.ts files via mapped types (builder types), producing TS4094 errors downstream.",
      },
      {
        selector: "MethodDefinition[accessibility='private'][kind!='constructor']",
        message:
          "Use ECMAScript private methods (#method()) instead of the TypeScript `private` modifier. Private constructors are the only permitted use of `private` since `#constructor` is not valid syntax.",
      },
      {
        selector: "TSParameterProperty[accessibility='private']",
        message:
          "Parameter properties cannot be ECMAScript private. Declare the field with `readonly #field` and assign it in the constructor body.",
      },
    ],
  },
};
