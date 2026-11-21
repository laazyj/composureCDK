import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteLinks } from "./markdown-links.mjs";

/** Rewrites every target starting with `../` to `ABS/…`, leaving the rest. */
const toAbsolute = (target) =>
  target.startsWith("../") ? { replace: `ABS/${target.slice(3)}` } : undefined;

const rewrite = (markdown) => rewriteLinks(markdown, toAbsolute);

describe("rewriteLinks", () => {
  it("rewrites inline links and images, keeping titles and anchors", () => {
    const { text, findings } = rewrite('See [x](../a.md#part "Title") and ![y](../b.png).');
    assert.equal(text, 'See [x](ABS/a.md#part "Title") and ![y](ABS/b.png).');
    assert.deepEqual(
      findings.map((f) => [f.line, f.target]),
      [
        [1, "../a.md#part"],
        [1, "../b.png"],
      ],
    );
  });

  it("handles every title form, angle brackets and parentheses in the destination", () => {
    assert.equal(rewrite("[x](../a.md 'T')").text, "[x](ABS/a.md 'T')");
    assert.equal(rewrite("[x](../a.md (T))").text, "[x](ABS/a.md (T))");
    assert.equal(rewrite("[x](<../my doc.md>)").text, "[x](<ABS/my doc.md>)");
    assert.equal(rewrite("[x](../a_(b).md)").text, "[x](ABS/a_(b).md)");
  });

  it("rewrites the outer link of a linked image as well as the image", () => {
    assert.equal(rewrite("[![i](../i.png)](../a.md)").text, "[![i](ABS/i.png)](ABS/a.md)");
  });

  it("rewrites reference definitions, including in blockquotes and on the next line", () => {
    assert.equal(rewrite("[x][r]\n\n[r]: ../c.md").text, "[x][r]\n\n[r]: ABS/c.md");
    assert.equal(rewrite("> [r]: <../my doc.md>").text, "> [r]: <ABS/my doc.md>");
    assert.equal(rewrite("[r]:\n  ../c.md 'T'").text, "[r]:\n  ABS/c.md 'T'");
  });

  it("rewrites href and src in HTML, with either quote", () => {
    assert.equal(
      rewrite("<img src=\"../d.svg\"> <a href='../e.md'>e</a>").text,
      "<img src=\"ABS/d.svg\"> <a href='ABS/e.md'>e</a>",
    );
  });

  it("treats a footnote as prose, not a reference definition", () => {
    const { text, findings } = rewrite("[^note]: The [x](../a.md) case.");
    assert.equal(text, "[^note]: The [x](ABS/a.md) case.");
    assert.equal(findings.length, 1);
  });

  it("leaves code, comments and escaped brackets alone", () => {
    const input = [
      "`[x](../a.md)` and ``a ` [x](../b.md)``",
      "",
      "    [indented](../c.md)",
      "",
      "```md",
      "[fenced](../d.md)",
      "```",
      "",
      "> ```",
      "> [quoted](../e.md)",
      "> ```",
      "",
      "<!-- [comment](../f.md) -->",
      "",
      "\\[escaped](../g.md)",
    ].join("\n");
    const { text, findings } = rewrite(input);
    assert.equal(text, input);
    assert.deepEqual(findings, []);
  });

  it("reports errors without changing the text", () => {
    const { text, findings } = rewriteLinks("[x](../gone.md)", () => ({ error: "missing" }));
    assert.equal(text, "[x](../gone.md)");
    assert.deepEqual(findings, [{ line: 1, target: "../gone.md", error: "missing" }]);
  });

  it("rewrites a destination written with escapes", () => {
    assert.equal(rewrite("[x](../a\\_b.md)").text, "[x](ABS/a_b.md)");
  });
});
