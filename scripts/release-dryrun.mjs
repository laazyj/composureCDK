#!/usr/bin/env node
// Local dry-run preview of `nx release`.
//
// We do NOT use `nx release --dry-run` (the top-level command) because nx@22
// rejects the top-level command when git options are configured granularly
// under `release.version.git` / `release.changelog.git` — and they must be,
// because the CI workflow (.github/workflows/release-prepare.yml) calls
// `nx release version` and `nx release changelog` as separate subcommands,
// which in turn reject a top-level `release.git`. Granular config is the only
// shape that satisfies both CI and the programmatic API used here. See the
// PR that introduced this script for the full history.

import { releaseChangelog, releaseVersion } from "nx/release";

const { workspaceVersion } = await releaseVersion({ dryRun: true, verbose: false });

if (!workspaceVersion) {
  console.log("\nNo version bump detected from conventional commits. Nothing to preview.");
  process.exit(0);
}

await releaseChangelog({ version: workspaceVersion, dryRun: true, verbose: false });
