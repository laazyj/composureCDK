// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import nx from "@nx/eslint-plugin";
import composurecdk from "@composurecdk/eslint-plugin";

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      // tshy's intermediates, written and removed during a build. A `lint` task
      // running alongside that package's `build` otherwise walks into them and
      // fails on files no tsconfig covers.
      "**/.tshy/",
      "**/.tshy-build/",
      "**/node_modules/",
      "**/cdk.out/",
      "**/coverage/",
      // Hand-written ESM/CJS consumption fixtures — each is deliberately a
      // specific module system and is exercised by spawning `node`, not linted.
      "packages/module-compat/test/fixtures/",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mjs",
            "scripts/*.mjs",
            "scripts/*.cjs",
            "scripts/cdk-floor/*.mjs",
            "packages/examples/test/smoke/*.mjs",
            "vitest.config.base.ts",
            "packages/*/vitest.config.ts",
          ],
        },
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["scripts/*.mjs", "scripts/cdk-floor/*.mjs", "packages/examples/test/smoke/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["scripts/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        console: "readonly",
      },
    },
    // CommonJS is required here: nx loads non-".ts" changelog renderers with
    // require(), which cannot import an ESM module in this "type": "module" repo.
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["vitest.config.base.ts", "packages/*/vitest.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // All four presets: this repo writes builders (`recommended`), publishes them
    // for others to compile against (`libraryAuthor`), ships both module formats
    // (`dualPublishing`), and owns the house rules (`internal`). A consumer takes
    // only the tiers true for them — a CDK application, for instance, takes
    // `recommended` alone. Each registers the same plugin object, so combining
    // them is not a redefinition.
    //
    // No preset declares `files` by design — scoping to library source is the
    // consumer's call, and this is ours.
    files: ["packages/*/src/**/*.ts"],
    ignores: ["packages/examples/src/**/*.ts", "packages/cdk-testing/src/**/*.ts"],
    extends: [
      composurecdk.configs.recommended,
      composurecdk.configs.libraryAuthor,
      composurecdk.configs.dualPublishing,
      composurecdk.configs.internal,
    ],
  },
  {
    // The examples are CDK applications: they publish nothing, emit no `.d.ts`
    // anyone compiles against, and ship one module format. So they take the one
    // tier that describes them — which is also what a consumer's own app takes.
    files: ["packages/examples/src/**/*.ts"],
    extends: [composurecdk.configs.recommended],
    rules: {
      // Nothing installs an application as a dependency, so it genuinely loads
      // once and its own relative imports cannot duplicate. A library must not
      // make this claim — see the rule's documentation.
      "composurecdk/no-realm-bound-instanceof": [
        "error",
        { assumeNeverInstalledAsADependency: true },
      ],
    },
  },
  {
    // Shared test helpers: private, built by plain `tsc` to one format, so the
    // dual-publishing rules do not apply. The other tiers do — 17 packages
    // compile against its `.d.ts`, and because their `test` target depends on
    // `^build`, its code also runs under every one of their aws-cdk-lib floors.
    // It declares no floor of its own but inherits the strictest of theirs,
    // which is why `internal` stays on.
    files: ["packages/cdk-testing/src/**/*.ts"],
    extends: [
      composurecdk.configs.recommended,
      composurecdk.configs.libraryAuthor,
      composurecdk.configs.internal,
    ],
  },
  {
    // The ADR-0018 type-level guards declare a `const` purely so its type
    // annotation forces an assignability check — the value is never read, and
    // the declaration IS the assertion. Allow the conventional `_` prefix to
    // mark that, rather than 33 disable comments or a `void` statement (which
    // typescript-eslint 8.70 now reports as meaningless, correctly: `void` is
    // for discarding a call's return value).
    files: ["packages/*/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
    },
  },
  {
    // @composurecdk/core is the root of the dependency graph. It stays
    // CDK-version-agnostic — depending only on `constructs` (peer) and
    // `@dagrejs/graphlib` — and must never import a sibling @composurecdk
    // package or a CDK construct library. See docs/architecture.md. This
    // encodes as lint what was previously an unwritten convention; the
    // graph-wide version (phantom deps, cycles, deep imports) is a planned
    // follow-up via @nx/enforce-module-boundaries.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "aws-cdk-lib",
                "aws-cdk-lib/*",
                "aws-cdk-lib/**",
                "@aws-cdk/*",
                "@aws-cdk/**",
              ],
              message:
                "@composurecdk/core must not depend on aws-cdk-lib or any @aws-cdk/* construct library — it stays CDK-version-agnostic and depends only on `constructs`. See docs/architecture.md.",
            },
            {
              group: ["@composurecdk/*", "@composurecdk/**"],
              message:
                "@composurecdk/core is the root of the dependency graph and must not import from any other @composurecdk package.",
            },
          ],
        },
      ],
    },
  },
  {
    // Graph-wide package boundaries via the Nx project graph. Tags live in
    // each package's package.json (`nx.tags`). This catches what a
    // specifier-level rule cannot: cross-package cycles, deep imports past a
    // package's public entry points, and reliance on undeclared (transitive)
    // dependencies — i.e. phantom deps. Siblings may depend on siblings by
    // design (e.g. cloudfront -> s3), so `scope:lib` may depend on itself.
    files: ["packages/*/src/**/*.ts"],
    plugins: { "@nx": nx },
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          // Also bans imports that don't resolve to a package's public entry
          // point — i.e. deep imports into another package's internals and
          // reliance on undeclared (transitive) dependencies.
          banTransitiveDependencies: true,
          // `estree` is a types-only module supplied by `@types/estree`, which
          // the eslint-plugin package declares as a devDependency. Nx keys the
          // transitive check on the import specifier, and `estree` has no
          // matching package name (the package is `@types/estree`), so the rule
          // cannot resolve it. The import is compile-time-only; allow it.
          allow: ["estree"],
          depConstraints: [
            {
              sourceTag: "scope:core",
              onlyDependOnLibsWithTags: [],
              bannedExternalImports: ["aws-cdk-lib", "@aws-cdk/*"],
            },
            {
              sourceTag: "scope:lib",
              onlyDependOnLibsWithTags: ["scope:core", "scope:lib"],
            },
            {
              sourceTag: "scope:aggregate",
              onlyDependOnLibsWithTags: ["scope:core", "scope:lib", "scope:aggregate"],
            },
            {
              // The linter itself. "Depends on nothing" is forced rather than
              // stylistic: nx.json makes every package's `lint` depend on this
              // package's `build`, and the root flat config imports its
              // compiled output — so a plugin that depended on a package would
              // mean linting that package required building it first.
              sourceTag: "scope:tooling",
              onlyDependOnLibsWithTags: [],
            },
            {
              // Shared test helpers. They may reach for `scope:core`'s
              // contracts — `Lifecycle`, `Grant` — rather than restating them
              // structurally, which is what they did while sharing
              // `scope:tooling`'s stricter rule. They must not depend on a
              // `scope:lib` package: every library's tests depend on these
              // helpers, so the helpers have to sit below all of them.
              sourceTag: "scope:testing",
              onlyDependOnLibsWithTags: ["scope:core"],
            },
          ],
        },
      ],
    },
  },
  {
    // The tagged-builder wrapper IS the implementation of the tagged-builder
    // surface — by definition it must reach for `Builder` / `IBuilder` from
    // `@composurecdk/core`. Disable the rule at the file level rather than
    // peppering disable comments through the body.
    files: ["packages/cloudformation/src/tagged-builder.ts"],
    rules: {
      "composurecdk/builder-must-be-tagged": "off",
    },
  },
  {
    files: ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"],
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
    },
  },
  eslintConfigPrettier,
);
