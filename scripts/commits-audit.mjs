#!/usr/bin/env node

/**
 * `commits:audit` — check that every commit pushed to `main` kept the agent
 * attribution of the pull request it came from. The pull-request check
 * (`commits:check`) cannot see the squash dialog, where the body is edited or
 * emptied at merge; this sees what landed. See docs/ci.md#auditing-main.
 *
 * For each commit it finds the merged pull request and that PR's commits, and
 * applies `mainCommitProblems` from commit-rules.mjs. A commit with problems
 * gets an issue assigned to whoever merged it (one per commit, never
 * duplicated), and the run fails, so the commit shows red on `main`.
 *
 * Commits come from the push event (`GITHUB_EVENT_PATH`) or, to audit by hand,
 * from `SHAS` (space-separated). With `SHAS` and no `OPEN_ISSUES=1`, it only
 * reports. Reads the API through the `gh` CLI, and needs `npm ci` for nx's
 * agent list (through commit-rules.mjs). Requires `GH_TOKEN`
 * with `contents: read`, `pull-requests: read` and, to open issues,
 * `issues: write`.
 *
 * Usage:
 *   GITHUB_REPOSITORY=owner/name SHAS="<sha> …" npx nx commits:audit
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { mainCommitProblems, pullRequestAgentSignal } from "./commit-rules.mjs";

const { GITHUB_REPOSITORY: repo, GITHUB_EVENT_PATH: eventPath, SHAS } = process.env;
if (!repo) {
  console.error("::error::GITHUB_REPOSITORY is required.");
  process.exit(1);
}

const shas = SHAS
  ? SHAS.split(/\s+/).filter(Boolean)
  : JSON.parse(readFileSync(eventPath, "utf8")).commits.map((c) => c.id);
const openIssues = SHAS ? process.env.OPEN_ISSUES === "1" : true;
for (const sha of shas) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    console.error(`::error::'${sha}' is not a commit SHA.`);
    process.exit(1);
  }
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const api = (path) => JSON.parse(gh("api", path));
const apiPages = (path) => JSON.parse(gh("api", "--paginate", "--slurp", path)).flat();
const toCommit = (c) => ({
  sha: c.sha,
  message: c.commit.message,
  authorEmail: c.commit.author?.email ?? "",
  parents: c.parents.map((p) => p.sha),
});

const findings = [];
for (const sha of shas) {
  const commit = toCommit(api(`repos/${repo}/commits/${sha}`));
  const pr = api(`repos/${repo}/commits/${commit.sha}/pulls`).find(
    (p) => p.merge_commit_sha === commit.sha,
  );
  const prCommits = pr ? apiPages(`repos/${repo}/pulls/${pr.number}/commits`).map(toCommit) : [];
  const agentSignal = pr ? pullRequestAgentSignal({ body: pr.body, headRef: pr.head?.ref }) : null;
  const problems = mainCommitProblems(commit, prCommits, agentSignal);
  const short = commit.sha.slice(0, 7);
  const subject = commit.message.split("\n", 1)[0];
  if (problems.length === 0) {
    console.log(`${short} OK: ${subject}`);
    continue;
  }
  for (const problem of problems) console.log(`::error::${short} ${problem}.`);
  findings.push({ commit, short, subject, problems, pr });
}

if (findings.length === 0) process.exit(0);

const marker = (sha) => `<!-- commits-audit:${sha} -->`;
for (const { commit, short, subject, problems, pr } of findings) {
  const lines = [
    `### ${short} ${subject}`,
    "",
    ...problems.map((p) => `- ${p}.`),
    "",
    pr ? `From #${pr.number}.` : "Pushed directly, not from a pull request.",
  ];
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n\n`);
  }
  if (!openIssues) continue;

  const existing = JSON.parse(
    gh(
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--search",
      `${commit.sha} in:body`,
      "--json",
      "number",
    ),
  );
  if (existing.length > 0) {
    console.log(`${short}: already reported in #${existing[0].number}.`);
    continue;
  }
  const merger = pr ? api(`repos/${repo}/pulls/${pr.number}`).merged_by?.login : undefined;
  const body = [
    marker(commit.sha),
    `Commit ${commit.sha} landed on \`main\` without the agent attribution its pull request carried.`,
    "",
    ...lines.slice(2),
    "",
    "History on `main` is not rewritten, so this issue is the record: note here which agent session(s) produced the change, then close it. See [docs/ci.md](https://github.com/laazyj/composureCDK/blob/main/docs/ci.md#auditing-main).",
  ].join("\n");
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    `Missing agent attribution on ${short}`,
    "--body",
    body,
  ];
  if (merger) args.push("--assignee", merger);
  console.log(gh(...args).trim());
}
process.exit(1);
