#!/usr/bin/env node

/**
 * `dependency-review` — fail a pull request that introduces a vulnerability.
 *
 * `actions/dependency-review-action` also fails bumps between two versions with
 * the same advisory, so it runs with `warn-only` for its report and this decides
 * the result. See docs/ci.md#dependency-review.
 *
 * Reads the compare API itself rather than the action's `dependency-changes`
 * output. A step can only receive that through an environment variable, which
 * Linux caps at 128 KiB, and an ordinary nx bump (#664) already reaches 88 KB.
 *
 * Any error exits non-zero, so a failure here cannot pass a PR.
 *
 * Drives the `gh` CLI, so `scripts/` stays dependency-free. Requires `GH_TOKEN`
 * (or an authenticated `gh`) with `contents: read`.
 *
 * Usage:
 *   GITHUB_REPOSITORY=owner/name BASE_SHA=<sha> HEAD_SHA=<sha> \
 *     node scripts/dependency-review.mjs
 */

import { execFileSync } from "node:child_process";
import { netNewAdvisories } from "./net-new-advisories.mjs";

const { GITHUB_REPOSITORY: repo, BASE_SHA: base, HEAD_SHA: head } = process.env;
if (!repo || !base || !head) {
  console.error("::error::GITHUB_REPOSITORY, BASE_SHA and HEAD_SHA are all required.");
  process.exit(1);
}

const pages = JSON.parse(
  execFileSync(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repo}/dependency-graph/compare/${base}...${head}`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);

const advisories = netNewAdvisories(pages.flat());

for (const { manifest, name, version, severity, ghsa, summary, url } of advisories) {
  console.error(
    `::error::${manifest} » ${name}@${version} adds ${ghsa} (${severity}): ${summary} ${url}`,
  );
}

if (advisories.length > 0) {
  process.exitCode = 1;
} else {
  console.log("No net-new advisories.");
}
