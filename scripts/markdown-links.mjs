/**
 * Finds and rewrites the links in a Markdown document.
 *
 * Kept free of filesystem access so it can be tested on strings: the caller
 * decides what each link target means through the `classify` callback.
 *
 * The document is parsed as CommonMark by `mdast-util-from-markdown`, so code
 * blocks, code spans, escapes and comments are never mistaken for links. A
 * link is a `link`, `image` or `definition` node, or an `href` / `src`
 * attribute in raw HTML. Edits are spliced into the original text at the
 * exact source range the parser reports, so everything else is left byte for
 * byte.
 */

import { fromMarkdown } from "mdast-util-from-markdown";

const ATTRIBUTE = /(\b(?:href|src)\s*=\s*(["']))(.*?)\2/g;

/**
 * Replaces the parser's default handler for a destination: it sets `url` as
 * that handler does, and also records where the destination sits in the
 * source, which mdast does not otherwise keep.
 */
function recordDestination(token) {
  const url = this.resume();
  const node = this.stack[this.stack.length - 1];
  node.url = url;
  node.data = { ...node.data, destination: [token.start, token.end] };
}

const DESTINATIONS = {
  exit: {
    resourceDestinationString: recordDestination,
    definitionDestinationString: recordDestination,
  },
};

/** Every node in the tree, depth first. */
function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

/**
 * Applies `classify` to every link target in `markdown`.
 *
 * `classify(target)` returns `undefined` to leave the link alone, `{ replace }`
 * to rewrite its target, or `{ error }` for a link that cannot be fixed.
 *
 * @returns The rewritten text, and one finding per link `classify` did not
 *   leave alone, with its 1-based line number.
 */
export function rewriteLinks(markdown, classify) {
  const findings = [];
  const edits = [];

  const consider = (target, start, end, line) => {
    const verdict = classify(target);
    if (verdict === undefined) return;
    findings.push({ line, target, ...verdict });
    if (verdict.replace !== undefined) edits.push({ start, end, text: verdict.replace });
  };

  const tree = fromMarkdown(markdown, { mdastExtensions: [DESTINATIONS] });
  for (const node of walk(tree)) {
    const destination = node.data?.destination;
    if (destination !== undefined) {
      const [start, end] = destination;
      consider(node.url, start.offset, end.offset, start.line);
    } else if (node.type === "html" && !node.value.startsWith("<!--")) {
      for (const match of node.value.matchAll(ATTRIBUTE)) {
        const start = node.position.start.offset + match.index + match[1].length;
        const line =
          node.position.start.line + node.value.slice(0, match.index).split("\n").length - 1;
        consider(match[3], start, start + match[3].length, line);
      }
    }
  }

  let text = markdown;
  for (const { start, end, text: replacement } of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  findings.sort((a, b) => a.line - b.line);
  return { text, findings };
}
