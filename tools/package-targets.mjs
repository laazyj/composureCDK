/**
 * nx plugin: derives each `packages/*` target from the package's shape, so the
 * commands are declared once rather than repeated in 25 package manifests.
 *
 * Targets run their tool directly through `nx:run-commands` rather than being
 * inferred from package.json `scripts`, which nx would run as `npm run
 * <script>` — concurrent npm startups intermittently abort inside npm's own
 * config loader, failing the task before the tool runs (#323).
 *
 * nx loads this during project-graph construction, so it must not import
 * anything the repo builds — see the `@nx/eslint` note in AGENTS.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const createNodes = [
  "packages/*/package.json",
  (manifestPaths, _options, context) =>
    manifestPaths.map((manifestPath) => {
      const root = dirname(manifestPath);
      return [
        manifestPath,
        { projects: { [root]: { targets: targets(root, context.workspaceRoot) } } },
      ];
    }),
];

function targets(root, workspaceRoot) {
  const manifest = JSON.parse(readFileSync(join(workspaceRoot, root, "package.json"), "utf8"));
  const run = (command) => ({ command, options: { cwd: root } });

  const dualPublished = "tshy" in manifest;
  const derived = {
    lint: run("eslint ."),
    typecheck: run("tsc --noEmit"),
    test: run("vitest run"),
    "test:watch": run("vitest watch"),
    "test:update": run("vitest run --update"),
    // A superset of every artefact any target writes, so it cannot drift per package.
    clean: run("rm -rf dist .tshy .tshy-build coverage cdk.out node_modules/.vite"),
  };
  if (dualPublished) {
    derived.build = run("tshy");
    derived["check:exports"] = run("attw --pack . --profile node16 && publint");
  } else if (existsSync(join(workspaceRoot, root, "tsconfig.build.json"))) {
    derived.build = run("tsc -p tsconfig.build.json");
  }
  return derived;
}
