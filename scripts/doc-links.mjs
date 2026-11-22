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
 * point it at. A GitHub link to this repo's `main` is checked as well: its
 * target must still exist, and it goes back to relative once the package
 * ships that target.
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
  return repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
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

/** `path` as a link from `file`, with each segment URL-encoded. */
function linkPath(from, path) {
  return relative(from, path).split(sep).map(encodeURIComponent).join("/");
}

/**
 * The `classify` callback for one doc: leaves links that work in the tarball,
 * rewrites ones that leave it, and reports ones whose target is missing.
 *
 * A link this script wrote, to `<base>/blob/main/…` or `<base>/tree/main/…`,
 * is checked too: its target must still exist, and if the package now ships
 * it, the link goes back to being relative.
 */
export function classifier(pkg, file, base) {
  const own = `${base}/`.toLowerCase();

  /** The target as a repo path, or `undefined` for a link to elsewhere. */
  const parse = (target) => {
    const onMain = target.toLowerCase().startsWith(own)
      ? /^(?:blob|tree)\/main\/(.*)$/s.exec(target.slice(own.length))?.[1]
      : undefined;
    const isUrl = onMain !== undefined;
    if (!isUrl && /^([a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) return undefined;
    const [, pathPart, suffix = ""] = /^([^#?]*)(.*)$/s.exec(onMain ?? target);
    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      return { error: "cannot decode the link target" };
    }
    const fromRoot = isUrl || decoded.startsWith("/");
    const path = fromRoot ? join(ROOT, decoded) : resolve(dirname(file), decoded);
    return { path, suffix, isUrl };
  };

  return (target) => {
    const parsed = parse(target);
    if (parsed?.path === undefined) return parsed;
    const { path, suffix, isUrl } = parsed;
    if (!existsSync(path)) return { error: "the link target does not exist" };

    // A shipped target wants a relative link, any other a GitHub URL.
    const shipped = ships(pkg, path);
    if (shipped !== isUrl) return undefined;
    if (shipped) {
      const rel = linkPath(dirname(file), path);
      return {
        replace: `${rel.startsWith("..") ? "" : "./"}${rel}${suffix}`,
        reason: "points at a file the package ships",
      };
    }
    const kind = statSync(path).isDirectory() ? "tree" : "blob";
    return {
      replace: `${base}/${kind}/main/${linkPath(ROOT, path)}${suffix}`,
      reason: "leaves the published package",
    };
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

      const fixes = [];
      for (const finding of findings) {
        if (finding.error !== undefined) {
          problems.push(`${name}:${finding.line}: ${finding.target}: ${finding.error}`);
        } else {
          fixes.push(finding);
        }
      }
      if (check) {
        for (const { line, target, replace, reason } of fixes) {
          problems.push(`${name}:${line}: ${target} ${reason}; use ${replace}`);
        }
      } else if (fixes.length > 0) {
        writeFileSync(file, text);
        rewritten += fixes.length;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
