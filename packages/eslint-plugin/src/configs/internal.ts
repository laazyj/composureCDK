import type { Linter } from "eslint";
import { recommended } from "./recommended.js";

/**
 * This repo's own preset: the consumer `recommended` rules plus the ones whose
 * premises hold only here. Exported so the root `eslint.config.mjs` has one
 * place to extend, not as a preset a consumer should adopt — the README says
 * why each addition does not travel.
 */
export const internal: Linter.Config = {
  ...recommended,
  rules: {
    ...recommended.rules,
    // Mandates `taggedBuilder` from @composurecdk/cloudformation.
    "composurecdk/builder-must-be-tagged": "error",
    // Keys on `stringConstraint(...)`, this repo's catalogue mechanism (ADR-0010).
    "composurecdk/constraint-metadata-required": "error",
    // Bans a hardcoded list of APIs above *this repo's* pinned peer floor (ADR-0008).
    "composurecdk/no-cdk-api-above-floor": "error",
    // Bans the TypeScript `private` modifier in favour of ECMAScript private
    // fields (#field), which `keyof T` does not expose and so cannot leak into
    // an emitted .d.ts as TS4094. Kept as `no-restricted-syntax` rather than a
    // custom rule because the selectors are mechanical and cover three closely
    // related cases that share a single rationale — and out of `recommended`
    // because setting a core rule from a preset replaces whatever the consumer
    // configured for it.
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
