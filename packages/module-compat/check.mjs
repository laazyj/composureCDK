#!/usr/bin/env node

/**
 * Consumer checks for the dual ESM/CJS packages (ADR-0007), run against an
 * install of them. See docs/ci.md#consumer-compatibility.
 *
 * Every `@composurecdk/*` package in this package's `peerDependencies` must
 * load under both `require()` and `import` with named exports, and every
 * fixture app below must exit 0. Each runs in a fresh `node`, because only a
 * real process exercises the export conditions.
 *
 * Plain Node and built-ins only, so it runs on every supported Node without
 * the dev toolchain.
 *
 * Usage:
 *   node check.mjs [install-root] [--fixture <path>]...
 *
 * `install-root` is where the packages resolve from: this package (the
 * default) for the workspace build, or a consumer project with the packed
 * tarballs installed. `--fixture` runs only the named fixtures and no package
 * checks, which is how the tests prove a failing fixture fails the run.
 */

import { execFile } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = ["cjs/synth.js", "esm/synth.js", "dual-realm/statement-builder.js"];

const args = process.argv.slice(2);
const fixtureFlags = args.flatMap((arg, i) => (args[i - 1] === "--fixture" ? [arg] : []));
const root = resolve(
  args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--fixture") ?? HERE,
);

// Fixtures resolve their imports from their own location, so outside the
// workspace they run from a copy inside the install.
const fixturesDir = join(root, "test", "fixtures");
if (root !== HERE) cpSync(join(HERE, "test", "fixtures"), fixturesDir, { recursive: true });

const packages = Object.keys(
  JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).peerDependencies,
).filter((name) => name.startsWith("@composurecdk/"));

const hasNamedExports =
  "if (Object.keys(m).filter((k) => k !== 'default').length === 0) throw new Error('no named exports');";
const checks = [
  ...(fixtureFlags.length > 0 ? [] : packages).flatMap((name) => [
    [
      `${name} via require()`,
      [
        "--input-type=commonjs",
        "--eval",
        `const m = require(${JSON.stringify(name)}); ${hasNamedExports}`,
      ],
    ],
    [
      `${name} via import`,
      [
        "--input-type=module",
        "--eval",
        `import * as m from ${JSON.stringify(name)}; ${hasNamedExports}`,
      ],
    ],
  ]),
  ...(fixtureFlags.length > 0 ? fixtureFlags : FIXTURES).map((fixture) => [
    `fixture ${fixture}`,
    [join(fixturesDir, fixture)],
  ]),
];

/** Runs one check in a fresh `node`, resolving to an error message, or undefined on success. */
function run([, nodeArgs]) {
  return new Promise((done) => {
    execFile(
      process.execPath,
      nodeArgs,
      { cwd: root, timeout: 120_000 },
      (error, _stdout, stderr) => {
        done(error === null ? undefined : stderr.trim() || error.message);
      },
    );
  });
}

// Independent processes, so run them a CPU's worth at a time; report in order.
const results = new Array(checks.length);
let next = 0;
await Promise.all(
  Array.from({ length: availableParallelism() }, async () => {
    while (next < checks.length) {
      const index = next++;
      results[index] = await run(checks[index]);
    }
  }),
);

let failures = 0;
checks.forEach(([label], index) => {
  const error = results[index];
  console.log(`${error === undefined ? "✓" : "✗"} ${label}`);
  if (error !== undefined) {
    failures += 1;
    console.error(`  ${error.replaceAll("\n", "\n  ")}`);
  }
});
const target = root === HERE ? "the workspace build" : root;
console.log(
  `\n${String(checks.length - failures)}/${String(checks.length)} consumer checks passed on Node ${process.version} against ${target}.`,
);
process.exitCode = failures > 0 ? 1 : 0;
