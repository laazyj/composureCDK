#!/usr/bin/env node

/**
 * `squash:merge` — squash-merge a pull request with the message main should
 * keep: the PR title and number, and the branch's one commit message as the
 * body, word for word. Run by `squash-merge.yml` when someone comments
 * `/squash`, so no merge dialog can empty the body or move its trailers. See
 * docs/ci.md#merging.
 *
 * It refuses, saying why in a comment on the pull request, unless
 * `squashMergeRefusals` in commit-rules.mjs finds nothing. The merge is pinned
 * to the head SHA it judged.
 *
 * After merging, it closes the issues the message's closing footers name,
 * which GitHub does not.
 *
 * `GH_TOKEN` reads the pull request, comments on it and closes the issues.
 * `MERGE_TOKEN`, a PAT, checks the commenter's permission and merges: a merge
 * made with `GITHUB_TOKEN` starts no workflows, and the release gate needs CI
 * to run on the commit. `DRY_RUN=1` prints the verdict and message instead, using
 * `GH_TOKEN` throughout.
 *
 * Usage:
 *   GITHUB_REPOSITORY=owner/name PR_NUMBER=<n> COMMENTER=<login> \
 *     DRY_RUN=1 npx nx squash:merge
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  closedIssues,
  pullRequestAgentSignal,
  squashMergeRefusals,
  squashMessage,
  toCommit,
} from "./commit-rules.mjs";

const { GITHUB_REPOSITORY: repo, PR_NUMBER: number, COMMENTER: login } = process.env;
const dryRun = process.env.DRY_RUN === "1";
const mergeToken = dryRun ? undefined : process.env.MERGE_TOKEN;
if (!repo || !/^\d+$/.test(number ?? "") || !login) {
  console.error("::error::GITHUB_REPOSITORY, a numeric PR_NUMBER and COMMENTER are all required.");
  process.exit(1);
}
if (!dryRun && !mergeToken) {
  console.error(
    "::error::MERGE_TOKEN is empty. Store a PAT as SQUASH_MERGE_TOKEN; see docs/ci.md#merging.",
  );
  process.exit(1);
}

const gh = (args, token) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: token ? { ...process.env, GH_TOKEN: token } : process.env,
  });
const api = (path, token) => JSON.parse(gh(["api", path], token));
// Each page as the API returns it: an array for a list, an object for a search.
const pagesOf = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path]));

/** Log each reason as an error, and write `text` to the run summary. */
function report(reasons, text) {
  for (const reason of reasons) console.log(`::error::${reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text.join("\n")}\n`);
  }
}

/** Report on the pull request and the run summary, then stop. */
function refuse(heading, reasons) {
  const text = [`**\`/squash\` did not merge:** ${heading}`, "", ...reasons.map((r) => `- ${r}`)];
  report(reasons, text);
  if (!dryRun) gh(["pr", "comment", number, "--repo", repo, "--body", text.join("\n")]);
  process.exit(1);
}

const pr = api(`repos/${repo}/pulls/${number}`);
const commits = pagesOf(`repos/${repo}/pulls/${number}/commits`).flat().map(toCommit);
const { permission } = api(`repos/${repo}/collaborators/${login}/permission`, mergeToken);
// The ruleset is the source of truth for which checks must pass, so a check
// added there is required here too without a change to this script.
const requiredChecks = api(`repos/${repo}/rules/branches/${encodeURIComponent(pr.base.ref)}`)
  .filter((rule) => rule.type === "required_status_checks")
  .flatMap((rule) => rule.parameters.required_status_checks.map((check) => check.context));
const checkRuns = pagesOf(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`).flatMap(
  (page) => page.check_runs,
);

const refusals = squashMergeRefusals({
  pr,
  login,
  permission,
  requiredChecks,
  checkRuns,
  commits,
  agentSignal: pullRequestAgentSignal({ body: pr.body, headRef: pr.head.ref }),
});
if (refusals.length > 0) refuse("it is not ready.", refusals);

const { subject, body } = squashMessage(pr.title, pr.number, commits);
const issues = closedIssues(body, repo);
if (dryRun) {
  console.log(`Would squash ${pr.head.sha.slice(0, 7)} as:\n\n${subject}\n\n${body}`);
  console.log(`\nWould close: ${issues.map((n) => `#${n}`).join(", ") || "nothing"}`);
  process.exit(0);
}

try {
  const merged = JSON.parse(
    gh(
      [
        "api",
        "--method",
        "PUT",
        `repos/${repo}/pulls/${number}/merge`,
        "-f",
        "merge_method=squash",
        "-f",
        `sha=${pr.head.sha}`,
        "-f",
        `commit_title=${subject}`,
        "-f",
        `commit_message=${body}`,
      ],
      mergeToken,
    ),
  );
  console.log(`Merged #${number} as ${merged.sha}: ${subject}`);
} catch (error) {
  // gh prints the API's reason: a push since the checks ran, a conflict, or a
  // token without the Workflows permission for a PR that changes a workflow.
  refuse("GitHub rejected the merge.", [String(error.stderr || error.message).trim()]);
}

/** Whether the issue is closed now, or `false` if it cannot be read. */
function isClosed(issue) {
  try {
    return api(`repos/${repo}/issues/${issue}`).state === "closed";
  } catch {
    return false;
  }
}

// The merge has landed, so a failure here is reported, not refused: the run
// fails so it shows, and the issue is left for a person to close.
for (const issue of issues) {
  try {
    const { state, pull_request: isPullRequest } = api(`repos/${repo}/issues/${issue}`);
    if (isPullRequest || state !== "open") continue;
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${repo}/issues/${issue}`,
      "-f",
      "state=closed",
      "-f",
      "state_reason=completed",
    ]);
    console.log(`Closed #${issue}.`);
  } catch (error) {
    // A description that also names the issue makes GitHub close it as the
    // merge lands. When that close falls between the read and the write
    // above, the write fails with HTTP 422, but the issue is closed.
    if (isClosed(issue)) {
      console.log(`#${issue} was already closed.`);
      continue;
    }
    const reason = `Merged, but could not close #${issue}: ${String(error.stderr || error.message).trim()}`;
    report([reason], [reason]);
    process.exitCode = 1;
  }
}
