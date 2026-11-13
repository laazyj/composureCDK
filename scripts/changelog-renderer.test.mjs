import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const Renderer = require("./changelog-renderer.cjs");

// extractBreakingChangeExplanation reads no instance state, so it is called on
// a bare prototype rather than a renderer built with a full release config.
const explain = (message) =>
  Renderer.prototype.extractBreakingChangeExplanation.call(
    Object.create(Renderer.prototype),
    message,
  );

// The body of 2713d75 (#712) as GitHub squashed it.
const SQUASHED = `Why it changed.

BREAKING CHANGE: an API that has already served traffic with execution
logging on already has a group of that name, and the deploy fails.
Delete the existing group before deploying, or set .executionLogging(false).

Closes #707


Agent-Session: https://claude.ai/code/session_01AbC

Co-authored-by: Claude <noreply@anthropic.com>`;

describe("extractBreakingChangeExplanation", () => {
  it("stops before issue references and session trailers", () => {
    assert.equal(
      explain(SQUASHED),
      "an API that has already served traffic with execution\n" +
        "logging on already has a group of that name, and the deploy fails.\n" +
        "Delete the existing group before deploying, or set .executionLogging(false).",
    );
  });

  it("stops at a trailer block that follows the note directly", () => {
    const message = `BREAKING CHANGE: x is gone.\n\nCo-authored-by: Claude <noreply@anthropic.com>\nAgent-Session: https://claude.ai/code/session_01AbC`;
    assert.equal(explain(message), "x is gone.");
  });

  it("keeps a note of several paragraphs", () => {
    const message = "BREAKING CHANGE: x is gone.\n\nUse y instead.\n\nRefs #1";
    assert.equal(explain(message), "x is gone.\n\nUse y instead.");
  });

  it("keeps a paragraph that only starts like a trailer", () => {
    const message =
      "BREAKING CHANGE: x is gone.\n\nNote: y replaces it, and\nreads the same props.";
    assert.equal(explain(message), "x is gone.\n\nNote: y replaces it, and\nreads the same props.");
  });

  it("stops at cross-repository references and Part of", () => {
    const message = "BREAKING CHANGE: x is gone.\n\nFixes owner/repo#12\nPart of #718";
    assert.equal(explain(message), "x is gone.");
  });

  it("returns null without a breaking-change footer", () => {
    assert.equal(explain("feat: x\n\nBody."), null);
  });
});
