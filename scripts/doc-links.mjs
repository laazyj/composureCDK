#!/usr/bin/env node

/**
 * Keeps every link in a published package's docs working on npm.
 *
 * A package's README, and any Markdown its `files` ships, is read on
 * npmjs.com and in `node_modules` as well as on GitHub. A relative link that
 * leaves the package, such as `../../docs/architecture.md`, works only on
 * GitHub: in the tarball its target is not there. The same goes for a link to
 * a file inside the package that `files` does not ship, such as `./src/x.ts`.
 *
 * Each such link is rewritten as an absolute GitHub URL on `main`, taken from
 * the root `repository` field. A link that stays inside what the package
 * ships is left relative, so it keeps working offline. A link whose target
 * does not exist is reported and not rewritten: there is nothing correct to
 * point it at.
 *
 * The docs checked are each published package's `README.md` and every `.md`
 * file under its `files` entries, bar `dist`, which holds build output only.
 *
 * - default: rewrite the links in place.
 * - `--check`: exit non-zero on any link that would be rewritten or is
 *   broken. Wired into `npx nx verify` and CI.
 *
 * Usage:
 *   node scripts/doc-links.mjs
 *   node scripts/doc-links.mjs --check
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteLinks } from "./markdown-links.mjs";
import { published } from "./published-packages.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `https://github.com/<owner>/<repo>`, from the root manifest's `repository`. */
function repositoryUrl() {
  const { repository } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const url = typeof repository === "string" ? repository : repository.url;
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

/** Every Markdown file under `path`, or `path` itself if it is one. */
function markdownUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return path.endsWith(".md") ? [path] : [];
  return readdirSync(path, { withFileTypes: true })
    .map((entry) => join(path, entry.name))
    .sort()
    .flatMap(markdownUnder);
}

/** The docs a package ships: its README, and Markdown under its `files`, bar `dist`. */
function publishedDocs({ dir, manifest }) {
  const entries = ["README.md", ...(manifest.files ?? []).filter((entry) => entry !== "dist")];
  return [...new Set(entries.flatMap((entry) => markdownUnder(join(dir, entry))))];
}

/** Whether `path` is inside `dir` and covered by one of its `files` entries. */
function ships({ dir, manifest }, path) {
  const rel = relative(dir, path);
  if (rel.startsWith("..") || rel === "") return false;
  if (rel === "package.json" || /^(README|LICENSE)(\.|$)/i.test(rel)) return true;
  return (manifest.files ?? []).some((entry) => rel === entry || rel.startsWith(entry + sep));
}

/**
 * The `classify` callback for one doc: leaves links that work in the tarball,
 * rewrites ones that leave it, and reports ones whose target is missing.
 */
function classifier(pkg, file, base) {
  return (target) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("//")) {
      return undefined;
    }
    const [, pathPart, suffix = ""] = /^([^#?]*)(.*)$/.exec(target);
    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      return { error: "cannot decode the link target" };
    }
    const path = decoded.startsWith("/") ? join(ROOT, decoded) : resolve(dirname(file), decoded);
    if (!existsSync(path)) return { error: "the link target does not exist" };
    if (ships(pkg, path)) return undefined;

    const kind = statSync(path).isDirectory() ? "tree" : "blob";
    const repoPath = relative(ROOT, path).split(sep).map(encodeURIComponent).join("/");
    return { replace: `${base}/${kind}/main/${repoPath}${suffix}` };
  };
}

function main() {
  const check = process.argv.includes("--check");
  const base = repositoryUrl();
  const problems = [];
  let rewritten = 0;

  for (const pkg of published()) {
    for (const file of publishedDocs(pkg)) {
      const { text, findings } = rewriteLinks(
        readFileSync(file, "utf8"),
        classifier(pkg, file, base),
      );
      const name = relative(ROOT, file);

      for (const finding of findings) {
        if (finding.error !== undefined) {
          problems.push(`${name}:${finding.line}: ${finding.target}: ${finding.error}`);
        } else if (check) {
          problems.push(
            `${name}:${finding.line}: ${finding.target} leaves the published package; use ${finding.replace}`,
          );
        }
      }
      const fixes = findings.filter((f) => f.replace !== undefined).length;
      if (!check && fixes > 0) {
        writeFileSync(file, text);
        rewritten += fixes;
      }
    }
  }

  if (!check && rewritten > 0) console.log(`doc-links: rewrote ${rewritten} link(s).`);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    if (check) console.error("\nRun `npx nx doc-links` to rewrite the links that can be fixed.");
    process.exit(1);
  }
}

main();
