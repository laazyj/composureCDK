#!/usr/bin/env node

/**
 * `commits:check` — fail a pull request whose squash commit would land badly
 * on `main`: more than one commit, a merge or autosquash commit, a body that
 * changes how nx reads the title, or an agent commit without its attribution
 * block. The rules live in commit-rules.mjs; see docs/ci.md#commits.
 *
 * Reads the pull request's commits through the API rather than from a
 * checkout, so it sees the branch's commits alone even when the PR is stacked
 * on another branch. Requires `GH_TOKEN` (or an authenticated `gh`) with
 * `pull-requests: read`.
 *
 * Usage:
 *   GITHUB_REPOSITORY=owner/name PR_NUMBER=<n> PR_TITLE=<title> \
 *     npx nx commits:check
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pullRequestProblems } from "./commit-rules.mjs";

const { GITHUB_REPOSITORY: repo, PR_NUMBER: number, PR_TITLE: title } = process.env;
if (!repo || !/^\d+$/.test(number ?? "") || !title) {
  console.error("::error::GITHUB_REPOSITORY, a numeric PR_NUMBER and PR_TITLE are all required.");
  process.exit(1);
}

const pages = JSON.parse(
  execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/commits`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const commits = pages.flat().map((c) => ({
  sha: c.sha,
  message: c.commit.message,
  authorEmail: c.commit.author?.email ?? "",
  parents: c.parents.map((p) => p.sha),
}));

const problems = pullRequestProblems({ title, number, commits });
if (problems.length === 0) {
  console.log(`Commits OK: ${commits.length} commit, squash lands as "${title} (#${number})".`);
  process.exit(0);
}

for (const problem of problems) console.log(`::error::${problem}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Commits",
      "",
      "This pull request would not land cleanly on `main`:",
      "",
      ...problems.map((p) => `- ${p}`),
      "",
      "See [How a pull request lands](https://github.com/laazyj/composureCDK/blob/main/CONTRIBUTING.md#how-a-pull-request-lands).",
      "",
    ].join("\n"),
  );
}
process.exit(1);
