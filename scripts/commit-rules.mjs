/**
 * The rules a commit on `main` must meet, shared by `commits:check` (on a pull
 * request, before merge) and `commits:audit` (on `main`, after). Pure apart from
 * loading nx's commit parser, so `commit-rules.test.mjs` can drive it with
 * plain objects. See docs/ci.md#commits and AGENTS.md#commits-and-pull-requests.
 *
 * A commit is `{ sha, message, authorEmail, parents }`, where `message` is the
 * full message (subject, blank line, body) and `parents` the parent SHAs.
 */

import { createRequire } from "node:module";

// nx's own code rather than copies of its regexes and lists, so the check reads
// commits exactly as `nx release` will, and follows it across upgrades. Both
// modules ship CommonJS and are reachable through nx's package exports.
const require = createRequire(import.meta.url);
const { parseGitCommit } = require("nx/src/command-line/release/utils/git.js");
const { isAiAgentAuthor } = require("nx/release/changelog-renderer").default.prototype;

/** Whether nx treats an email address as a coding agent's (and so keeps it out of "Thank You"). */
export const isAgentEmail = (email) => isAiAgentAuthor({ email: (email ?? "").trim() });

export const CLAUDE_EMAIL = "noreply@anthropic.com";
export const CLAUDE_CO_AUTHOR = `Co-authored-by: Claude <${CLAUDE_EMAIL}>`;
// A session URL, or `<tool> <version>; model <model> <version>` when there is none.
const SESSION_TRAILER = /^Agent-Session: (https:\/\/\S+|\S.*; model \S.*)$/;
const ANY_SESSION_LINE = /^agent-session:/im;
const LEGACY_SESSION_LINE = /^claude-session:/im;
const CO_AUTHOR_LINE = /^co-authored-by:\s*(?<name>.*?)\s*<(?<email>[^>]+)>\s*$/i;
const TRAILER_LINE = /^[A-Za-z0-9][A-Za-z0-9-]*: \S/;
const AUTOSQUASH_SUBJECT = /^(fixup|squash|amend)! /;

/** The subject line of a commit message. */
export const subjectOf = (message) => message.split("\n", 1)[0];

/** Everything after the subject line, with the separating blank line removed. */
export const bodyOf = (message) =>
  message
    .split("\n")
    .slice(1)
    .join("\n")
    .replace(/^\s*\n/, "");

/**
 * The trailers git would read: the lines of the message's last paragraph, if
 * every line in it is a `Key: value` trailer. Stricter than git, which
 * tolerates some non-trailer lines, so a block that passes here always parses.
 */
export function trailersOf(message) {
  const paragraphs = message
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim());
  if (paragraphs.length < 2) return [];
  const lines = paragraphs.at(-1).split("\n");
  return lines.every((line) => TRAILER_LINE.test(line)) ? lines : [];
}

/** The `Co-authored-by` lines in some text, as `{ line, name, email }`. */
export const coAuthorsOf = (lines) =>
  lines.flatMap((line) => {
    const match = CO_AUTHOR_LINE.exec(line.trim());
    return match ? [{ line: line.trim(), ...match.groups }] : [];
  });

/**
 * How a commit shows that a coding agent worked on it, if at all: authored or
 * co-authored from an address nx recognises as an agent's, or naming a
 * session. The last covers an agent nx does not know.
 */
export function agentInvolvement({ message, authorEmail }) {
  const authored = isAgentEmail(authorEmail);
  const coAuthored = coAuthorsOf(message.split("\n")).some((c) => isAgentEmail(c.email));
  const session = ANY_SESSION_LINE.test(message) || LEGACY_SESSION_LINE.test(message);
  return { authored, coAuthored, session, any: authored || coAuthored || session };
}

/**
 * Problems with one commit's attribution block. A commit an agent worked on
 * must end with a `Co-authored-by` trailer naming it, with no model or version
 * in the name. One an agent authored, or that names a session, must also carry
 * an `Agent-Session` trailer in that paragraph. A person's commit that credits
 * an assistant may have no session to give.
 */
export function attributionProblems(commit) {
  const involvement = agentInvolvement(commit);
  if (!involvement.any) return [];
  const problems = [];
  const lines = commit.message.split("\n");
  const trailers = trailersOf(commit.message);

  if (lines.some((line) => LEGACY_SESSION_LINE.test(line))) {
    problems.push("uses `Claude-Session:`; write `Agent-Session:`");
  }
  for (const { line, name, email } of coAuthorsOf(lines)) {
    if (email.toLowerCase() === CLAUDE_EMAIL && line !== CLAUDE_CO_AUTHOR) {
      problems.push(`uses \`${line}\`; write exactly \`${CLAUDE_CO_AUTHOR}\``);
    } else if (isAgentEmail(email) && /\d/.test(name)) {
      problems.push(`names a model or version in \`${line}\`; name only the agent`);
    }
  }
  const finalCoAuthors = coAuthorsOf(trailers);
  const credited =
    involvement.authored || involvement.coAuthored
      ? finalCoAuthors.some((c) => isAgentEmail(c.email))
      : finalCoAuthors.length > 0;
  if (!credited) {
    problems.push(
      "does not end with a `Co-authored-by:` trailer for the agent " +
        `(for Claude, \`${CLAUDE_CO_AUTHOR}\`)`,
    );
  }
  if (
    (involvement.authored || involvement.session) &&
    !trailers.some((line) => SESSION_TRAILER.test(line))
  ) {
    problems.push(
      "has no `Agent-Session:` trailer in its last paragraph, giving the session URL " +
        "or `<tool> <version>; model <model> <version>`",
    );
  }
  return problems;
}

/**
 * The squash commit GitHub builds from a pull request, with the repository's
 * settings (subject `PR_TITLE`, body `COMMIT_MESSAGES`): one commit's body as
 * it is, or several commits' full messages as a bulleted list.
 */
export function squashMessage(title, number, commits) {
  const subject = `${title} (#${number})`;
  const body =
    commits.length === 1
      ? bodyOf(commits[0].message)
      : commits.map(({ message }) => `* ${message.trim()}`).join("\n\n");
  return { subject, body };
}

/** How nx release reads a commit: its changelog type and whether it is breaking. */
export function nxReading(subject, body) {
  const parsed = parseGitCommit({
    message: subject,
    body,
    shortHash: "0000000",
    author: { name: "", email: "" },
  });
  return { type: parsed.type, breaking: parsed.isBreaking };
}

/**
 * Problems with a pull request before it is squash-merged. `title` is the PR
 * title (checked separately against Conventional Commits), `commits` the
 * branch's commits, oldest first.
 */
export function pullRequestProblems({ title, number, commits }) {
  const problems = [];

  if (commits.length > 1) {
    problems.push(
      `The branch has ${commits.length} commits. A pull request is one release-notes entry, ` +
        "so fold them into one commit whose message is the one main should keep " +
        "(`git rebase -i --autosquash`, or `git reset --soft` and recommit), then " +
        "`git push --force-with-lease`. Two entries need two (stacked) pull requests.",
    );
  }
  for (const commit of commits) {
    const short = commit.sha.slice(0, 7);
    const subject = subjectOf(commit.message);
    if (commit.parents.length > 1) {
      problems.push(`${short} is a merge commit ("${subject}"). Rebase onto the base instead.`);
    }
    if (AUTOSQUASH_SUBJECT.test(subject)) {
      problems.push(`${short} is an autosquash commit ("${subject}"). Squash it into its target.`);
    }
    for (const problem of attributionProblems(commit)) {
      problems.push(`${short} ("${subject}") ${problem}.`);
    }
  }

  if (commits.length > 0) {
    const titleOnly = nxReading(title, "");
    const { subject, body } = squashMessage(title, number, commits);
    const squashed = nxReading(subject, body);
    if (squashed.type !== titleOnly.type) {
      problems.push(
        `nx would record the squash commit as \`${squashed.type}\`, not the title's ` +
          `\`${titleOnly.type}\`: a commit body quotes \`This reverts commit <sha>.\`. ` +
          "Reword it, or title the pull request as the revert it is.",
      );
    }
    if (squashed.breaking !== titleOnly.breaking) {
      problems.push(
        "nx would record the squash commit as breaking, but the title has no `!`: a commit " +
          "body contains `BREAKING CHANGE:`. Add `!` to the title, or reword the body.",
      );
    }
  }

  return problems;
}
