import type { Linter } from "eslint";
import { recommended } from "./recommended.js";

/**
 * This repo's own preset: the consumer {@link recommended} rules plus the ones
 * whose premises are local to ComposureCDK's source. It is exported so the
 * root `eslint.config.mjs` has a single place to extend, not as a preset a
 * consumer is expected to adopt — each of the additions below assumes
 * something about the project it lints that is only true here.
 *
 * Apply to `packages/* /src/**\/*.ts` (library source). File-level overrides
 * (e.g. for the `tagged-builder.ts` implementation itself) belong in the
 * consumer's config, not here.
 */
export const internal: Linter.Config = {
  rules: {
    ...recommended.rules,
    // Mandates `taggedBuilder` from @composurecdk/cloudformation — both a
    // dependency and a strong opinion about how builders are constructed.
    "composurecdk/builder-must-be-tagged": "error",
    // Keys on `stringConstraint(...)`, this repo's catalogue mechanism (ADR-0010).
    "composurecdk/constraint-metadata-required": "error",
    // Bans a hardcoded list of APIs above *this repo's* pinned peer floor
    // (ADR-0008). A project on a different floor gets a different list.
    "composurecdk/no-cdk-api-above-floor": "error",
    // Bans the TypeScript `private` modifier in favour of ECMAScript private
    // fields (#field). TS `private` members appear in `keyof T` and leak into
    // emitted .d.ts files via mapped types (builder types), producing TS4094
    // errors downstream. Kept as `no-restricted-syntax` rather than a custom
    // rule because the selectors are mechanical and cover three closely
    // related cases that share a single rationale. It stays out of the
    // consumer preset because setting a core rule from a preset replaces
    // whatever the consumer configured for it wholesale.
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
