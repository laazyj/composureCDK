import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLAUDE_CO_AUTHOR,
  agentInvolvement,
  attributionProblems,
  isAgentEmail,
  mainCommitProblems,
  nxReading,
  pullRequestProblems,
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
