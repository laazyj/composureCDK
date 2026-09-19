import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { rules } from "../src/rules/index.js";

// `import.meta` is banned in `src/` (it has no CommonJS emit) but tests are
// never published, and this needs a path relative to the package rather than
// the working directory the runner happens to use.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(PACKAGE_ROOT, "docs", "rules");
const README = join(PACKAGE_ROOT, "README.md");

const RULE_ENTRIES = Object.entries(rules);
const RULE_NAMES = RULE_ENTRIES.map(([name]) => name);

/**
 * These assertions are what make it safe to have moved each rule's rationale out
 * of its source and into one page. A single source of truth only stays true if
 * something notices when it drifts.
 */
describe("rule documentation", () => {
  it.each(RULE_ENTRIES)("%s declares a meta.docs.url matching its rule id", (name, rule) => {
    const url = rule.meta?.docs?.url;

    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\/github\.com\/laazyj\/composureCDK\/blob\/main\//);
    expect(url?.endsWith(`/${name}.md`)).toBe(true);
  });

  it.each(RULE_NAMES)("%s has a documentation page", (name) => {
    expect(existsSync(join(DOCS_DIR, `${name}.md`))).toBe(true);
  });

  it.each(RULE_NAMES)("%s page leads with its own rule id", (name) => {
    const body = readFileSync(join(DOCS_DIR, `${name}.md`), "utf8");

    expect(body.split("\n")[0]).toBe(`# composurecdk/${name}`);
  });

  it("has no page for a rule that no longer exists", () => {
    const pages = readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));

    expect(pages.sort()).toEqual([...RULE_NAMES].sort());
  });

  it.each(RULE_NAMES)("%s is listed in the README and linked to its page", (name) => {
    const readme = readFileSync(README, "utf8");

    expect(readme).toContain(`composurecdk/${name}`);
    expect(readme).toContain(`docs/rules/${name}.md`);
  });
});
