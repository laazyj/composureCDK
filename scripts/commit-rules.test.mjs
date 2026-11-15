import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAUDE_CO_AUTHOR,
  agentInvolvement,
  attributionProblems,
  isAgentEmail,
  mainCommitProblems,
  mergedTitle,
  nxReading,
  pullRequestAgentSignal,
  pullRequestProblems,
  squashBodyProblems,
  squashMergeRefusals,
  squashMessage,
  trailersOf,
} from "./commit-rules.mjs";

const SESSION = "Agent-Session: https://claude.ai/code/session_01AbCdEf";
const PERSON = "someone@example.com";
const CLAUDE = "noreply@anthropic.com";

let next = 0;
const commit = (message, { authorEmail = PERSON, parents = ["p"] } = {}) => ({
  sha: `${(next++).toString(16).padStart(7, "0")}deadbeef`,
  message,
  authorEmail,
  parents,
});
const agentCommit = (body = "Why it changed.") =>
  commit(`feat(s3): add a thing\n\n${body}\n\n${CLAUDE_CO_AUTHOR}\n${SESSION}`, {
    authorEmail: CLAUDE,
  });
const pr = (commits, title = "feat(s3): add a thing") =>
  pullRequestProblems({ title, number: "42", commits });

describe("trailersOf", () => {
  it("reads a final paragraph of trailers", () => {
    assert.deepEqual(trailersOf(`fix: x\n\nBody.\n\n${CLAUDE_CO_AUTHOR}\n${SESSION}\n`), [
      CLAUDE_CO_AUTHOR,
      SESSION,
    ]);
  });

  it("does not read trailers split across paragraphs as one block", () => {
    assert.deepEqual(trailersOf(`fix: x\n\nBody.\n\n${SESSION}\n\n${CLAUDE_CO_AUTHOR}`), [
      CLAUDE_CO_AUTHOR,
    ]);
  });

  it("finds none when the last paragraph is prose", () => {
    assert.deepEqual(trailersOf(`fix: x\n\n${SESSION}\n\nA closing sentence.`), []);
  });

  it("finds none in a subject-only message", () => {
    assert.deepEqual(trailersOf("fix: x"), []);
  });
});

describe("isAgentEmail", () => {
  it("follows nx's list of coding agents", () => {
    assert.equal(isAgentEmail(CLAUDE), true);
    assert.equal(isAgentEmail("cursoragent@cursor.com"), true);
    assert.equal(isAgentEmail("198982749+Copilot@users.noreply.github.com"), true);
    assert.equal(isAgentEmail(PERSON), false);
  });
});

describe("agentInvolvement", () => {
  it("sees a session line from an agent nx does not know", () => {
    const { any, session } = agentInvolvement(
      commit(
        "fix: x\n\nCo-authored-by: Tool <bot@example.com>\nAgent-Session: Tool 1.0; model m 2",
      ),
    );
    assert.deepEqual({ any, session }, { any: true, session: true });
  });
});

describe("attributionProblems", () => {
  it("passes a commit with no sign of an agent", () => {
    assert.deepEqual(attributionProblems(commit("fix: x\n\nBody.")), []);
  });

  it("passes an agent commit ending with the block", () => {
    assert.deepEqual(attributionProblems(agentCommit()), []);
  });

  it("passes another agent's block with a tool-and-model session", () => {
    const message =
      "fix: x\n\nBody.\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n" +
      "Agent-Session: Cursor 2.1.0; model some-model 2026-06";
    assert.deepEqual(
      attributionProblems(commit(message, { authorEmail: "cursoragent@cursor.com" })),
      [],
    );
  });

  it("passes an unknown agent identified only by its session line", () => {
    const message =
      "fix: x\n\nBody.\n\nCo-authored-by: Tool <bot@example.com>\nAgent-Session: Tool 1.0; model m 2";
    assert.deepEqual(attributionProblems(commit(message)), []);
  });

  it("fails an agent-authored commit with no block", () => {
    const problems = attributionProblems(commit("fix: x\n\nBody.", { authorEmail: CLAUDE }));
    assert.equal(problems.length, 2);
  });

  it("fails a Claude co-author line with a model name and asks for the canonical one", () => {
    const problems = attributionProblems(
      commit(`fix: x\n\nCo-Authored-By: Claude Opus 5.5 <${CLAUDE}>\n${SESSION}`),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Claude Opus 5\.5/);
  });

  it("fails another agent's co-author line that names a version", () => {
    const problems = attributionProblems(
      commit("fix: x\n\nCo-authored-by: Cursor 2.1 <cursoragent@cursor.com>"),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /model or version/);
  });

  it("fails the old Claude-Session trailer", () => {
    const old = SESSION.replace("Agent-Session", "Claude-Session");
    const problems = attributionProblems(
      commit(`fix: x\n\n${CLAUDE_CO_AUTHOR}\n${old}`, { authorEmail: CLAUDE }),
    );
    assert.match(problems[0], /write `Agent-Session:`/);
  });

  it("fails a session with neither a URL nor a model", () => {
    const problems = attributionProblems(
      commit(`fix: x\n\n${CLAUDE_CO_AUTHOR}\nAgent-Session: my laptop`, { authorEmail: CLAUDE }),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Agent-Session/);
  });

  it("fails a session line that is not in the final trailer block", () => {
    const problems = attributionProblems(
      commit(`fix: x\n\n${SESSION}\n\n${CLAUDE_CO_AUTHOR}`, { authorEmail: CLAUDE }),
    );
    assert.deepEqual(problems.length, 1);
    assert.match(problems[0], /Agent-Session/);
  });

  it("lets a person's commit credit an agent without a session", () => {
    assert.deepEqual(attributionProblems(commit(`fix: x\n\nBody.\n\n${CLAUDE_CO_AUTHOR}`)), []);
  });
});

describe("squashMessage", () => {
  it("uses a single commit's body as it is", () => {
    assert.deepEqual(squashMessage("fix: x", 7, [commit("fix: y\n\nBody.")]), {
      subject: "fix: x (#7)",
      body: "Body.",
    });
  });

  it("lists several commits' full messages", () => {
    const { body } = squashMessage("fix: x", 7, [commit("fix: a\n\nOne."), commit("fix: b")]);
    assert.equal(body, "* fix: a\n\nOne.\n\n* fix: b");
  });
});

describe("nxReading", () => {
  it("reads type and breaking from the subject", () => {
    assert.deepEqual(nxReading("feat(s3)!: x (#1)", ""), { type: "feat", breaking: true });
  });

  it("is turned breaking by the body", () => {
    assert.equal(nxReading("feat: x", "BREAKING CHANGE: gone").breaking, true);
  });

  it("is turned into a revert by a quoted full hash", () => {
    assert.equal(nxReading("feat: x", `This reverts commit ${"a".repeat(40)}.`).type, "revert");
  });
});

describe("pullRequestProblems", () => {
  it("passes one clean agent commit", () => {
    assert.deepEqual(pr([agentCommit()]), []);
  });

  it("passes a dependency bump with no attribution", () => {
    assert.deepEqual(
      pr(
        [commit("build(deps): bump x\n\nBumps x.\n\nSigned-off-by: dependabot[bot] <x@y>")],
        "build(deps): bump x",
      ),
      [],
    );
  });

  it("fails more than one commit", () => {
    const problems = pr([agentCommit(), agentCommit()]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2 commits/);
  });

  it("fails merge and autosquash commits", () => {
    const problems = pr([commit("Merge branch 'main'", { parents: ["a", "b"] })]);
    assert.match(problems.join("\n"), /merge commit/);
    assert.match(pr([commit("fixup! feat: x")]).join("\n"), /autosquash/);
  });

  it("fails a body that makes a non-breaking title breaking", () => {
    const problems = pr([commit("feat: x\n\nBREAKING CHANGE: the old prop is gone.")]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /breaking/);
  });

  it("passes the same body under a breaking title", () => {
    const message = "feat!: x\n\nBREAKING CHANGE: the old prop is gone.";
    assert.deepEqual(pr([commit(message)], "feat(s3)!: add a thing"), []);
  });

  it("fails a body that quotes a revert hash under a feat title", () => {
    const problems = pr([commit(`feat: x\n\nThis reverts commit ${"b".repeat(40)}.`)]);
    assert.match(problems.join("\n"), /`revert`, not the title's\s+`feat`/);
  });

  it("passes a short revert hash, which nx ignores", () => {
    assert.deepEqual(pr([commit("feat: x\n\nThis reverts commit 508f812.")]), []);
  });

  it("reports attribution problems against the commit", () => {
    const problems = pr([commit("feat: x", { authorEmail: CLAUDE })]);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /^[0-9a-f]{7} \("feat: x"\)/);
  });
});

describe("mainCommitProblems", () => {
  const squash = (body) => commit(`feat(s3): add a thing (#42)\n\n${body}`);

  it("passes a commit no agent touched", () => {
    assert.deepEqual(mainCommitProblems(squash("Body."), [commit("feat: x\n\nBody.")]), []);
  });

  it("passes GitHub's default squash layout, with the session stranded above", () => {
    const landed = squash(`Why it changed.\n\n${SESSION}\n\n${CLAUDE_CO_AUTHOR}`);
    assert.deepEqual(mainCommitProblems(landed, [agentCommit()]), []);
  });

  it("fails a body emptied at merge, as on 6afccc7", () => {
    const problems = mainCommitProblems(commit("feat(s3): add a thing (#42)"), [agentCommit()]);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /no `Co-authored-by/);
    assert.match(problems[1], /dropped `Agent-Session/);
  });

  it("fails when one of the pull request's sessions was cut", () => {
    const other = "Agent-Session: https://claude.ai/code/session_02Other";
    const second = agentCommit(`More.\n\n${CLAUDE_CO_AUTHOR}\n${other}`);
    const landed = squash(`Body.\n\n${CLAUDE_CO_AUTHOR}\n${SESSION}`);
    const problems = mainCommitProblems(landed, [agentCommit(), second]);
    assert.deepEqual(problems, [`dropped \`${other}\` from its pull request's commits`]);
  });

  it("fails a Claude-authored pull request that never named a session", () => {
    const old = commit("feat: x\n\nBody.", { authorEmail: CLAUDE });
    const problems = mainCommitProblems(squash(`Body.\n\n${CLAUDE_CO_AUTHOR}`), [old]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /names no `Agent-Session`/);
  });

  it("audits a direct push on its own message", () => {
    assert.deepEqual(mainCommitProblems(agentCommit(), []), []);
    assert.equal(mainCommitProblems(commit("fix: x", { authorEmail: CLAUDE }), []).length, 2);
  });

  it("requires another agent's own co-author line", () => {
    const cursor = commit(
      "fix: x\n\nBody.\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n" +
        "Agent-Session: Cursor 2.1.0; model some-model 2026-06",
      { authorEmail: "cursoragent@cursor.com" },
    );
    const session = "Agent-Session: Cursor 2.1.0; model some-model 2026-06";
    const problems = mainCommitProblems(squash(`Body.\n\n${session}\n\n${CLAUDE_CO_AUTHOR}`), [
      cursor,
    ]);
    assert.deepEqual(problems, ["has no `Co-authored-by:` trailer for cursoragent@cursor.com"]);
  });
});

describe("squashBodyProblems", () => {
  const PR = { number: 42, title: "fix(s3): x" };
  const BODY = "Why it changed.\n\nCloses #12";
  const personal = commit(`fix(s3): x\n\n${BODY}`);
  const landed = (body, subject = "fix(s3): x (#42)") =>
    commit(body === "" ? subject : `${subject}\n\n${body}`);

  it("passes the body `/squash` writes, give or take trailing whitespace", () => {
    assert.deepEqual(squashBodyProblems(landed(BODY), PR, [personal]), []);
    assert.deepEqual(squashBodyProblems(landed(`${BODY}  \n\n`), PR, [personal]), []);
  });

  it("fails a person's pull request emptied at merge, as on #761, naming the lost footer", () => {
    assert.deepEqual(squashBodyProblems(landed(""), PR, [personal]), [
      "landed with an empty body, where its pull request's commit message has one",
      "dropped `Closes #12`, so the release notes no longer link the issue",
    ]);
  });

  it("fails a body edited in the merge dialog", () => {
    const problems = squashBodyProblems(landed("Why it changed.\n\nRefs #12"), PR, [personal]);
    assert.deepEqual(problems, [
      "landed with a body that differs from its pull request's commit message",
      "dropped `Closes #12`, so the release notes no longer link the issue",
    ]);
  });

  it("passes the web dialog's layout: co-authors moved to the end, session stranded", () => {
    const moved = `${BODY}\n\n${SESSION}\n\n${CLAUDE_CO_AUTHOR}`;
    assert.deepEqual(squashBodyProblems(landed(moved), PR, [agentCommit(BODY)]), []);
  });

  it("leaves a dropped agent co-author to mainCommitProblems, so it is reported once", () => {
    const source = agentCommit(BODY);
    const cut = landed(`${BODY}\n\n${SESSION}`);
    assert.deepEqual(squashBodyProblems(cut, PR, [source]), []);
    assert.deepEqual(mainCommitProblems(cut, [source]), [
      "has no `Co-authored-by:` trailer for noreply@anthropic.com",
    ]);
  });

  it("fails a person's co-author dropped, or one added that no commit credits", () => {
    const pair = "Co-authored-by: Pat <pat@example.com>";
    const source = commit(`fix(s3): x\n\n${BODY}\n\n${pair}`);
    assert.deepEqual(squashBodyProblems(landed(BODY), PR, [source]), [
      `dropped \`${pair}\` from its pull request's commits`,
    ]);
    const stranger = "Co-authored-by: Sam <sam@example.com>";
    assert.deepEqual(squashBodyProblems(landed(`${BODY}\n\n${stranger}`), PR, [personal]), [
      `added \`${stranger}\`, which no commit in its pull request credits`,
    ]);
  });

  it("passes a release pull request merged with the buttons, as 90bf811 landed", () => {
    const bot = "41898282+github-actions[bot]@users.noreply.github.com";
    const release = commit("chore(release): v0.13.0", { authorEmail: bot });
    const merged = landed(
      `Co-authored-by: github-actions[bot] <${bot}>`,
      "chore(release): v0.13.0 (#704)",
    );
    assert.deepEqual(squashBodyProblems(merged, { number: 704, title: "x" }, [release]), []);
  });

  it("checks a Dependabot pull request like any other", () => {
    const bot = "49699333+dependabot[bot]@users.noreply.github.com";
    const body =
      "Bumps x from 1 to 2.\n\n---\nupdated-dependencies: ...\n\nSigned-off-by: dependabot[bot] <support@github.com>";
    const bump = commit(`build(deps): bump x\n\n${body}`, { authorEmail: bot });
    const pr = { number: 7, title: "build(deps): bump x" };
    const merged = (b) => landed(b, "build(deps): bump x (#7)");
    const viaButtons = merged(`${body}\n\nCo-authored-by: dependabot[bot] <${bot}>`);
    assert.deepEqual(squashBodyProblems(viaButtons, pr, [bump]), []);
    assert.equal(squashBodyProblems(merged(""), pr, [bump]).length, 1);
  });

  it("compares several commits as GitHub's bulleted list", () => {
    const commits = [commit("fix: a\n\nOne."), commit("fix: b\n\nTwo.")];
    const bulleted = landed("* fix: a\n\nOne.\n\n* fix: b\n\nTwo.");
    assert.deepEqual(squashBodyProblems(bulleted, PR, commits), []);
    assert.equal(squashBodyProblems(landed("One."), PR, commits).length, 1);
  });

  it("skips a direct push, which has nothing to compare against", () => {
    assert.deepEqual(squashBodyProblems(commit("fix: x"), PR, []), []);
  });
});

describe("mergedTitle", () => {
  it("reads the title from the landed subject, so a later edit does not count", () => {
    const merged = commit("fix(s3): the title at merge (#42)\n\nBody.");
    assert.equal(
      mergedTitle(merged, { number: 42, title: "fix(s3): renamed since" }),
      "fix(s3): the title at merge",
    );
  });

  it("falls back to the pull request's title when the subject has no number", () => {
    assert.equal(mergedTitle(commit("fix: edited"), { number: 42, title: "fix: x" }), "fix: x");
  });
});

describe("pullRequestAgentSignal", () => {
  it("fires on an agent branch", () => {
    assert.match(
      pullRequestAgentSignal({ body: "", headRef: "claude/sleepy-bardeen" }),
      /claude\//,
    );
    assert.match(pullRequestAgentSignal({ body: "", headRef: "copilot/fix-1" }), /copilot\//);
  });

  it("fires on a generated-by footer, as on #731", () => {
    const body =
      "## What & why\n\nStuff.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n";
    assert.equal(
      pullRequestAgentSignal({ body, headRef: "feat/wafv2-2-logging" }),
      "says it was generated by an agent",
    );
  });

  it("stays quiet for a person's or a bot's pull request", () => {
    assert.equal(pullRequestAgentSignal({ body: "Bumps x.", headRef: "dependabot/npm/x" }), null);
    assert.equal(pullRequestAgentSignal({ body: null, headRef: "release/v0.14.0" }), null);
    assert.equal(
      pullRequestAgentSignal({ body: "Mentions 🤖 Generated with mid-line.", headRef: "feat/x" }),
      null,
    );
  });
});

describe("agent-signalled pull requests", () => {
  const signal = "says it was generated by an agent";
  // #731: a local session committing under a person's identity, no trailers.
  const unattributed = () => commit("feat(wafv2): log web ACL traffic\n\nRefs #708");

  it("fails a commit with no attribution, and says why", () => {
    const problems = pullRequestProblems({
      title: "feat(wafv2): log web ACL traffic",
      number: "731",
      commits: [unattributed()],
      agentSignal: signal,
    });
    assert.equal(problems.length, 2);
    for (const problem of problems)
      assert.match(problem, /\(the pull request says it was generated/);
  });

  it("passes the same commit once it carries the block", () => {
    const fixed = commit(
      `feat(wafv2): log web ACL traffic\n\nRefs #708\n\n${CLAUDE_CO_AUTHOR}\n${SESSION}`,
    );
    assert.deepEqual(
      pullRequestProblems({
        title: "feat(wafv2): log web ACL traffic",
        number: "731",
        commits: [fixed],
        agentSignal: signal,
      }),
      [],
    );
  });

  it("accepts a tool-and-model session for an agent nx does not know", () => {
    const message =
      "fix: x\n\nBody.\n\nCo-authored-by: Tool <bot@example.com>\nAgent-Session: Tool 1.0; model m 2";
    assert.deepEqual(attributionProblems(commit(message), { agentPr: true }), []);
  });

  it("fails the landed commit on main when nothing was attributed", () => {
    const problems = mainCommitProblems(
      commit("feat(wafv2): log web ACL traffic (#731)\n\nRefs #708"),
      [unattributed()],
      signal,
    );
    assert.deepEqual(problems, [
      "has no `Co-authored-by:` trailer for the agent",
      `names no \`Agent-Session\`, though its pull request ${signal}`,
    ]);
  });
});

describe("squashMergeRefusals", () => {
  const run = (name, conclusion = "success", { status = "completed", at = "07:00" } = {}) => ({
    name,
    status,
    conclusion,
    started_at: `2026-11-15T${at}:00Z`,
  });
  const ready = (overrides = {}) => ({
    pr: {
      number: 42,
      title: "feat(s3): add a thing",
      state: "open",
      draft: false,
      base: { ref: "main", repo: { default_branch: "main" } },
    },
    login: "maintainer",
    permission: "admin",
    requiredChecks: ["CI", "PR policy"],
    checkRuns: [run("CI"), run("PR policy")],
    commits: [agentCommit()],
    ...overrides,
  });

  it("merges a ready pull request", () => {
    assert.deepEqual(squashMergeRefusals(ready()), []);
  });

  it("refuses a commenter who cannot merge", () => {
    const [refusal] = squashMergeRefusals(ready({ permission: "read" }));
    assert.match(refusal, /`maintainer` has read access/);
  });

  it("refuses a draft, a closed pull request and a stacked one", () => {
    const pr = {
      ...ready().pr,
      state: "closed",
      draft: true,
      base: { ref: "claude/below", repo: { default_branch: "main" } },
    };
    const refusals = squashMergeRefusals(ready({ pr }));
    assert.equal(refusals.length, 3);
    assert.match(refusals[2], /targets `claude\/below`, not `main`/);
  });

  it("judges each required check by its latest run", () => {
    const checkRuns = [
      run("CI"),
      run("CI", "failure", { at: "08:00" }),
      run("PR policy", null, { status: "in_progress", at: "08:00" }),
      run("Unrequired", "failure", { at: "08:00" }),
    ];
    assert.deepEqual(squashMergeRefusals(ready({ checkRuns })), [
      "The required check **CI** finished as `failure`.",
      "The required check **PR policy** is still running.",
    ]);
  });

  it("refuses when a required check has no run yet", () => {
    assert.deepEqual(squashMergeRefusals(ready({ checkRuns: [] })), [
      "The required check **CI** has not finished on the head commit. It may still be running.",
      "The required check **PR policy** has not finished on the head commit. It may still be running.",
    ]);
  });

  it("refuses commits that would not land cleanly", () => {
    const refusals = squashMergeRefusals(ready({ commits: [agentCommit(), agentCommit()] }));
    assert.match(refusals[0], /The branch has 2 commits/);
  });
});
