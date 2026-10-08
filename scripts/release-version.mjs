#!/usr/bin/env node

/**
 * `release-version` — `nx release version` for release-prepare, without
 * nx.json's `nx verify` pre-version command, which still guards local runs.
 *
 * In release-prepare that verify would be the third run of the same gates: the
 * workflow requires CI to have passed the commit, and the release branch is
 * verified again by deploy-test and the release PR's CI. nx has no flag to
 * skip the command, so this overrides it through the programmatic API.
 *
 * Usage:
 *   SPECIFIER=0.11.0 npx nx release:version
 */

import { ReleaseClient } from "nx/release";

const client = new ReleaseClient({ version: { preVersionCommand: "" } });

await client.releaseVersion({
  specifier: process.env.SPECIFIER || undefined,
  verbose: false,
});
