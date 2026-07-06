#!/usr/bin/env node

/**
 * `coverage-summary` — merge every package's `coverage/coverage-summary.json`
 * (emitted by the vitest `json-summary` reporter, wired in
 * `vitest.config.base.ts`) into a single markdown table.
 *
 * Self-contained coverage reporting for PRs — no external service. Run after
 * `npm run test` in CI; the output is:
 *
 *   1. printed to stdout,
 *   2. written to `coverage/coverage-summary.md` (the CI job feeds this file to
 *      the sticky PR-comment action), and
 *   3. appended to `$GITHUB_STEP_SUMMARY` when present, so coverage also shows
 *      on the Actions run page.
 *
 * Per-package pass/fail is already enforced by each `vitest.config.ts`'s
 * `perFile` thresholds during `npm run test`; this script only *reports*, it
 * does not gate.
 *
 * Usage:
 *   node scripts/coverage-summary.mjs                # default output path
 *   node scripts/coverage-summary.mjs --out=path.md  # custom markdown path
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg
  ? resolve(outArg.slice("--out=".length))
  : join(repoRoot, "coverage", "coverage-summary.md");

const METRICS = ["statements", "branches", "functions", "lines"];

// Absolute-percentage buckets for the at-a-glance marker. Per-package
// thresholds live in each vitest.config.ts and are enforced by the test run
// itself — these are just a visual cue, not a gate.
function marker(pct) {
  if (pct >= 90) return "🟢";
  if (pct >= 75) return "🟡";
  return "🔴";
}

function pctCell(entry) {
  const pct = typeof entry?.pct === "number" ? entry.pct : 0;
  return `${marker(pct)} ${pct.toFixed(2)}%`;
}

// Discover packages that actually produced a coverage summary. Packages with
// no vitest run (or excluded from coverage) are simply absent — reported as a
// skipped count so silent gaps are visible.
const rows = [];
const skipped = [];
for (const name of readdirSync(packagesDir).sort()) {
  const summaryPath = join(packagesDir, name, "coverage", "coverage-summary.json");
  let raw;
  try {
    raw = readFileSync(summaryPath, "utf8");
  } catch {
    skipped.push(name);
    continue;
  }
  const total = JSON.parse(raw).total;
  rows.push({ name, total });
}

// Overall coverage = sum of covered / sum of total across packages, per metric
// (a plain average of percentages would over-weight tiny packages).
const overall = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
for (const { total } of rows) {
  for (const m of METRICS) {
    overall[m].covered += total[m].covered;
    overall[m].total += total[m].total;
  }
}
const overallPct = Object.fromEntries(
  METRICS.map((m) => {
    const { covered, total } = overall[m];
    return [m, { pct: total === 0 ? 100 : (covered / total) * 100 }];
  }),
);

const lines = [];
lines.push("## Coverage");
lines.push("");
if (rows.length === 0) {
  lines.push(
    "No `coverage/coverage-summary.json` files found — did the test run produce coverage?",
  );
} else {
  lines.push(
    `Overall line coverage: **${overallPct.lines.pct.toFixed(2)}%** across ${rows.length} package(s).`,
  );
  lines.push("");
  lines.push("| Package | Statements | Branches | Functions | Lines |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const { name, total } of rows) {
    lines.push(`| ${name} | ${METRICS.map((m) => pctCell(total[m])).join(" | ")} |`);
  }
  lines.push(`| **Total** | ${METRICS.map((m) => pctCell(overallPct[m])).join(" | ")} |`);
  if (skipped.length > 0) {
    lines.push("");
    lines.push(`_No coverage reported for: ${skipped.join(", ")}._`);
  }
}
lines.push("");
const markdown = lines.join("\n");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown);
process.stdout.write(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
