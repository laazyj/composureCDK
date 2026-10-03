/**
 * Consumer checks for the dual ESM/CJS packages (ADR-0007), run against an
 * install of them. See docs/ci.md#consumer-compatibility.
 *
 * Every `@composurecdk/*` package in this package's `peerDependencies` must
 * load under both `require()` and `import` with named exports, and every
 * fixture app must exit 0. Each runs in a fresh `node`, because only a real
 * process exercises the export conditions. Plain Node and built-ins only, so
 * `check.mjs`, the command line over this, runs on every supported Node.
 */

import { execFile } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's directory: the install root for the workspace build. */
export const HERE = dirname(fileURLToPath(import.meta.url));

const FIXTURES = ["cjs/synth.js", "esm/synth.js", "dual-realm/statement-builder.js"];

const hasNamedExports =
  "if (Object.keys(m).filter((k) => k !== 'default').length === 0) throw new Error('no named exports');";

/**
 * Runs the checks, a CPU's worth of `node` processes at a time.
 *
 * @param {object} [options]
 * @param {string} [options.root] Where the packages resolve from: this package
 *   (the default) for the workspace build, or a consumer project with the
 *   packed tarballs installed.
 * @param {string[]} [options.fixtures] Run only these fixtures, named relative
 *   to `test/fixtures/`, and no package checks.
 * @returns {Promise<{ label: string, error: string | undefined }[]>} One entry
 *   per check, in order; `error` is the child's stderr (or the exec error when
 *   it wrote none) for a failed check.
 */
export async function runChecks({ root = HERE, fixtures } = {}) {
  // Fixtures resolve their imports from their own location, so outside the
  // workspace they run from a copy inside the install.
  const fixturesDir = join(root, "test", "fixtures");
  if (root !== HERE) cpSync(join(HERE, "test", "fixtures"), fixturesDir, { recursive: true });

  const packages = fixtures?.length
    ? []
    : Object.keys(
        JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).peerDependencies,
      ).filter((name) => name.startsWith("@composurecdk/"));

  const checks = [
    ...packages.flatMap((name) => [
      {
        label: `${name} via require()`,
        args: [
          "--input-type=commonjs",
          "--eval",
          `const m = require(${JSON.stringify(name)}); ${hasNamedExports}`,
        ],
      },
      {
        label: `${name} via import`,
        args: [
          "--input-type=module",
          "--eval",
          `import * as m from ${JSON.stringify(name)}; ${hasNamedExports}`,
        ],
      },
    ]),
    ...(fixtures?.length ? fixtures : FIXTURES).map((fixture) => ({
      label: `fixture ${fixture}`,
      args: [join(fixturesDir, fixture)],
    })),
  ];

  const errors = new Array(checks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: availableParallelism() }, async () => {
      while (next < checks.length) {
        const index = next++;
        errors[index] = await new Promise((done) => {
          execFile(
            process.execPath,
            checks[index].args,
            { cwd: root, timeout: 120_000 },
            (error, _stdout, stderr) => {
              done(error === null ? undefined : stderr.trim() || error.message);
            },
          );
        });
      }
    }),
  );
  return checks.map(({ label }, index) => ({ label, error: errors[index] }));
}
