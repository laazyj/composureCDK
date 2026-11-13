// Custom nx release changelog renderer.
//
// Two changes to nx's DefaultChangelogRenderer; everything else is inherited,
// so upstream changelog changes flow through on upgrade. Wired in via
// release.changelog.workspaceChangelog.renderer in nx.json. Preview with
// `npx nx release:dryrun`.
//
// - The "❤️ Thank You" authors heading becomes the skull mark from
//   jasonduffett.net.
// - A breaking-change note stops before the commit's trailers. nx copies
//   everything after the footer up to a `Co-authored-by:` line, and GitHub's
//   squash moves that line to the very end, so `Closes #N`, `Agent-Session:`
//   and the like were published in the notes (#712's in 0.14.0's preview).
//
// CommonJS (.cjs): nx resolves non-".ts" renderer paths with require(), which
// cannot load an ESM module even though this workspace is "type": "module".
const DefaultChangelogRenderer = require("nx/release/changelog-renderer").default;

// A `Key: value` git trailer, or an issue reference on a line of its own.
const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*: \S/;
const ISSUE_REFERENCE_LINE =
  /^(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|part of)\b:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+/i;

const isTrailerParagraph = (paragraph) =>
  paragraph
    .split("\n")
    .every((line) => TRAILER_LINE.test(line.trim()) || ISSUE_REFERENCE_LINE.test(line.trim()));

/**
 * The breaking-change note up to, not including, the first paragraph made only
 * of trailers and issue references. The note's own first paragraph is always
 * kept, so a one-line note that happens to read `Key: value` survives.
 */
function trimTrailers(explanation) {
  if (!explanation) return explanation;
  const paragraphs = explanation.split(/\n\s*\n/);
  const end = paragraphs.findIndex((p, i) => i > 0 && isTrailerParagraph(p.trim()));
  return (end === -1 ? paragraphs : paragraphs.slice(0, end)).join("\n\n").trim();
}

class ComposureChangelogRenderer extends DefaultChangelogRenderer {
  async renderAuthors() {
    const lines = await super.renderAuthors();
    return lines.map((line) => line.replace("❤️ Thank You", "💀 Thank You"));
  }

  extractBreakingChangeExplanation(message) {
    return trimTrailers(super.extractBreakingChangeExplanation(message));
  }
}

module.exports = ComposureChangelogRenderer;
module.exports.trimTrailers = trimTrailers;
