#!/usr/bin/env node

/**
 * `release-gate` — decide whether a commit on `main` may be tagged for release.
 *
 * `main` does not require a PR to be up to date before it merges, so the
 * squash commit a release PR lands as is not the tree its checks ran on: a
 * merge in between puts it on a newer `main`. What ships is the commit on
 * `main`, so that commit is what gets gated. It may be tagged only when:
 *
 *   1. its subject is `chore(release): vX.Y.Z`, the tag does not exist yet,
 *      and it is on `main`;
 *   2. CI passed that exact commit: its latest `ci.yml` run succeeded; and
 *   3. a Deploy Test run succeeded on a commit with the *same tree*. Equal
 *      trees are equal bytes, so the release PR's own deploy counts whenever
 *      nothing landed on `main` between cutting the branch and merging it.
 *      Only when something did is the deploy re-run, on the merged commit.
 *
 * The script only reads; release-tag.yml acts on the decision it writes to
 * `$GITHUB_OUTPUT`:
 *
 *   tag     — every gate passed: tag the commit.
 *   deploy  — CI passed but no deploy covers this tree: push the commit to
 *             `release/vX.Y.Z`, which runs Deploy Test on it. Its completion
 *             runs release-tag again.
 *   wait    — a run this depends on has not finished; its completion runs
 *             release-tag again.
 *   skip    — nothing to do: not a release commit, not on `main`, or tagged.
 *
 * A failed gate exits non-zero, so a stalled release shows as a red run.
 *
 * `--ci-only` checks gate 2 alone, for release-prepare.yml: it versions from
 * `main`'s HEAD only once CI has passed it. One implementation, so the commit a
 * release is cut from and the commit it is tagged at pass the same test. There
 * a run still in progress fails rather than waits, since nothing re-runs it.
 *
 * Drives the `gh` CLI, so `scripts/` stays dependency-free. Requires `GH_TOKEN`
 * (or an authenticated `gh`) with `actions: read`, `contents: read` and
 * `pull-requests: read`.
 *
 * Usage:
 *   node scripts/release-gate.mjs --sha=<commit>
 *   node scripts/release-gate.mjs --sha=<commit> --repo=owner/name
 *   node scripts/release-gate.mjs --sha=<commit> --ci-only
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function fatal(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const sha = flag("sha");
const ciOnly = argv.includes("--ci-only");
const repo = flag("repo", process.env.GITHUB_REPOSITORY);

if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
  fatal(`Not a full commit SHA: "${sha ?? ""}". Pass --sha=<40 hex characters>.`);
}
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  fatal(`Not an owner/name repository: "${repo ?? ""}". Pass --repo=owner/name.`);
}

function api(path) {
  const out = execFileSync("gh", ["api", `repos/${repo}/${path}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
}

function decide(decision, reason, version = "") {
  console.log(`${decision}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decision}\nversion=${version}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${decision}** — ${reason}\n`);
  }
  process.exit(0);
}

/** Every run of a workflow file on one commit, any event, newest first. */
function runs(workflow, commit) {
  return api(`actions/workflows/${workflow}/runs?head_sha=${commit}&per_page=100`).workflow_runs;
}

const succeeded = (list) => list.some((run) => run.conclusion === "success");
const pending = (list) => list.some((run) => run.status !== "completed");

/**
 * Whether CI passed a commit, by its *latest* `ci.yml` run: a push run and a
 * later weekly run can share a commit, and a failure in the later one (a new
 * advisory, say) outranks the earlier pass. Found by workflow file, not check
 * name, so renaming a job cannot block releases. `missing` when CI never ran.
 */
function ciState(commit) {
  const [latest] = runs("ci.yml", commit);
  if (!latest) return "missing";
  return latest.status === "completed" ? latest.conclusion : "pending";
}

if (ciOnly) {
  const state = ciState(sha);
  if (state !== "success") {
    fatal(`CI for ${sha} is '${state}', not success. Wait for CI on main to pass, then re-run.`);
  }
  console.log(`CI passed ${sha}.`);
  process.exit(0);
}

// 1. A release commit on main, not yet tagged.
const commit = api(`commits/${sha}`);
const subject = commit.commit.message.split("\n")[0];
const tree = commit.commit.tree.sha;
// Same SemVer shape release-notify.yml requires of the tag. GitHub's squash
// merge appends ` (#NN)`, which names the release PR.
const match =
  /^chore\(release\): v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?: \(#(\d+)\))?\s*$/.exec(
    subject,
  );
if (!match) decide("skip", `${sha} is not a release commit: "${subject}".`);
const [, version, pr] = match;
const tag = `v${version}`;

const tagged = api(`git/matching-refs/tags/${tag}`).some((ref) => ref.ref === `refs/tags/${tag}`);
if (tagged) decide("skip", `${tag} already exists.`, version);

// "behind" or "identical": every commit of sha is in main.
const { status } = api(`compare/main...${sha}`);
if (status !== "behind" && status !== "identical") {
  decide(
    "skip",
    `${sha} is not on main (${status}); release branches are gated by their PR.`,
    version,
  );
}

// 2. CI on this exact commit.
const ci = ciState(sha);
if (ci !== "success") {
  if (ci === "pending" || ci === "missing") {
    decide("wait", `CI has not passed ${sha} yet; its completion runs this again.`, version);
  }
  fatal(
    `CI is '${ci}' on ${sha}, so ${tag} is not tagged. Re-run CI on main once fixed, or cut a new release.`,
  );
}

// 3. Deploy Test on this tree: this commit, or the release PR's head when the
//    merge changed nothing but the commit.
const deploys = runs("deploy-test.yml", sha);
if (succeeded(deploys)) decide("tag", `CI and Deploy Test passed ${sha}.`, version);

if (pr) {
  const head = api(`pulls/${pr}`).head.sha;
  const headTree = api(`commits/${head}`).commit.tree.sha;
  if (headTree === tree && succeeded(runs("deploy-test.yml", head))) {
    decide(
      "tag",
      `CI passed ${sha}; Deploy Test passed #${pr}'s head ${head}, the same tree.`,
      version,
    );
  }
  if (headTree !== tree) {
    console.log(
      `::notice::${sha} differs from #${pr}'s head ${head}: main moved before the merge.`,
    );
  }
}

if (pending(deploys)) {
  decide("wait", `Deploy Test is running on ${sha}; its completion runs this again.`, version);
}
if (deploys.length > 0) {
  fatal(
    `Deploy Test failed on ${sha}, so ${tag} is not tagged. Re-run it if the failure was the sandbox, or cut a new release.`,
  );
}
decide("deploy", `No Deploy Test covers ${sha}'s tree; deploying it from release/${tag}.`, version);
