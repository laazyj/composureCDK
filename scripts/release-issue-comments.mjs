#!/usr/bin/env node

/**
 * `release-issue-comments` — tell every issue a release addressed which version
 * it shipped in.
 *
 * The release notes (the workspace `CHANGELOG.md` section, rendered by nx)
 * already link the issues and PRs behind each entry, but nobody watching an
 * issue learns that its fix is out. This posts one comment per issue naming the
 * version and linking the release.
 *
 * Issues are discovered from the release body two ways, because neither alone
 * is complete:
 *
 *   1. `…/issues/N` links — what nx renders from `Closes #N` footers in commit
 *      messages.
 *   2. `…/pull/N` links, expanded to that PR's linked closing issues. The PR
 *      template asks for `Closes #123` in the *PR body*, which never reaches
 *      the squash commit message, so nx cannot see those at all.
 *
 * Candidates are then filtered to real issues: GitHub's `/issues/N` URL
 * resolves a PR number just as happily, and the changelog does contain such
 * links.
 *
 * Drives the `gh` CLI, so `scripts/` stays dependency-free — the same way
 * `smoke-test.mjs` uses the AWS CLI. Requires `GH_TOKEN` (or an authenticated
 * `gh`) with `issues: write`.
 *
 * Usage:
 *   node scripts/release-issue-comments.mjs                      # $GITHUB_REF_NAME
 *   node scripts/release-issue-comments.mjs --tag=v0.9.1
 *   node scripts/release-issue-comments.mjs --tag=v0.9.1 --dry-run
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

const dryRun = argv.includes("--dry-run");
const tag = flag("tag", process.env.GITHUB_REF_NAME);
const repo = flag("repo", process.env.GITHUB_REPOSITORY);

if (!tag) {
  fatal("No release tag. Pass --tag=vX.Y.Z or run with GITHUB_REF_NAME set.");
}
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  fatal(`Not an owner/name repository: "${repo ?? ""}". Pass --repo=owner/name.`);
}

const [owner, name] = repo.split("/");
const version = tag.replace(/^v/, "");
// Keys the comment to this release, so a re-run announces nothing twice while
// a later release still gets its own comment on the same issue.
const marker = `<!-- composurecdk-release: ${tag} -->`;

/** Runs `gh` and returns trimmed stdout. Throws on any non-zero exit. */
function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw new Error(`gh ${args.join(" ")} failed:\n${stderr ?? String(error)}`, { cause: error });
  }
}

const CLOSING_ISSUES_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 50) {
          nodes {
            number
          }
        }
      }
    }
  }
`;

function closingIssues(pull) {
  const out = gh([
    "api",
    "graphql",
    "-f",
    `query=${CLOSING_ISSUES_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${pull}`,
    "--jq",
    ".data.repository.pullRequest.closingIssuesReferences.nodes[].number",
  ]);
  return out.split("\n").filter(Boolean).map(Number);
}

/** Null when the number does not resolve — deleted, or a cross-repo reference. */
function describe(number) {
  try {
    return JSON.parse(
      gh([
        "api",
        `repos/${repo}/issues/${number}`,
        "--jq",
        "{ isPullRequest: (.pull_request != null), title: .title }",
      ]),
    );
  } catch {
    return null;
  }
}

function alreadyCommented(number) {
  const bodies = gh([
    "api",
    `repos/${repo}/issues/${number}/comments`,
    "--paginate",
    "--jq",
    ".[].body",
  ]);
  return bodies.includes(marker);
}

const release = JSON.parse(gh(["release", "view", tag, "--repo", repo, "--json", "body,url"]));

// Fixed versioning (nx.json `projectsRelationship: "fixed"`) means every
// package carries this version, so the npm line can be stated as a wildcard.
const commentBody = [
  marker,
  "",
  `Addressed in **${tag}** — see the [release notes](${release.url}).`,
  "",
  `Published to npm as \`@composurecdk/*@${version}\`.`,
  "",
].join("\n");

// Cross-repo links do appear in changelog entries (dependency bumps), so the
// slug is matched rather than assumed. GitHub treats it case-insensitively.
const LINK_PATTERN = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(issues|pull)\/(\d+)/g;

const candidates = new Set();
const pulls = new Set();
for (const [, slug, kind, number] of release.body.matchAll(LINK_PATTERN)) {
  if (slug.toLowerCase() !== repo.toLowerCase()) continue;
  (kind === "issues" ? candidates : pulls).add(Number(number));
}
for (const pull of pulls) {
  for (const issue of closingIssues(pull)) {
    candidates.add(issue);
  }
}

const commented = [];
const skipped = [];
const failed = [];

for (const number of [...candidates].sort((a, b) => a - b)) {
  const issue = describe(number);
  if (issue === null) {
    skipped.push(`#${number} — does not resolve in ${repo}`);
    continue;
  }
  if (issue.isPullRequest) {
    skipped.push(`#${number} — a pull request, not an issue`);
    continue;
  }
  if (alreadyCommented(number)) {
    skipped.push(`#${number} — already announced for ${tag}`);
    continue;
  }
  try {
    if (!dryRun) {
      gh([
        "api",
        `repos/${repo}/issues/${number}/comments`,
        "--method",
        "POST",
        "-f",
        `body=${commentBody}`,
      ]);
    }
    commented.push(`#${number} — ${issue.title}`);
  } catch (error) {
    failed.push(`#${number} — ${error.message.split("\n")[0]}`);
  }
}

const lines = [
  `## Release notifications for ${tag}${dryRun ? " (dry run — nothing posted)" : ""}`,
  "",
  `${commented.length} commented, ${skipped.length} skipped, ${failed.length} failed.`,
  "",
];
if (dryRun) {
  lines.push("```markdown", commentBody.trimEnd(), "```", "");
}
for (const [heading, entries] of [
  ["Commented", commented],
  ["Skipped", skipped],
  ["Failed", failed],
]) {
  if (entries.length === 0) continue;
  lines.push(`### ${heading}`, "");
  lines.push(...entries.map((entry) => `- ${entry}`), "");
}

const summary = lines.join("\n");
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

// Partial success is still worth failing on: the release is already out, so an
// unannounced issue needs a human to notice and re-run.
if (failed.length > 0) {
  process.exit(1);
}
