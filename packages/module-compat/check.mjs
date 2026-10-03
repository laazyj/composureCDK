#!/usr/bin/env node

/**
 * Command line over checks.mjs (see `runChecks` there for what the arguments
 * mean): runs the consumer checks and exits non-zero if any fail.
 *
 * Usage:
 *   node check.mjs [install-root] [--fixture <path>]...
 */

import { resolve } from "node:path";
import { HERE, runChecks } from "./checks.mjs";

const args = process.argv.slice(2);
const fixtures = args.flatMap((arg, i) => (args[i - 1] === "--fixture" ? [arg] : []));
const root = resolve(
  args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--fixture") ?? HERE,
);

const results = await runChecks({ root, fixtures });
for (const { label, error } of results) {
  console.log(`${error === undefined ? "✓" : "✗"} ${label}`);
  if (error !== undefined) console.error(`  ${error.replaceAll("\n", "\n  ")}`);
}
const failures = results.filter(({ error }) => error !== undefined).length;
const target = root === HERE ? "the workspace build" : root;
console.log(
  `\n${String(results.length - failures)}/${String(results.length)} consumer checks passed on Node ${process.version} against ${target}.`,
);
process.exitCode = failures > 0 ? 1 : 0;
