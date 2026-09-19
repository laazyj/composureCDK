#!/usr/bin/env node

/**
 * CDK feature-flag posture tooling. `cdk-flags.json` is the curated source of
 * truth: every flag aws-cdk-lib ships for a service this repo wraps carries a
 * recorded decision. Flags for services we do not wrap are out of scope and
 * are not listed — `modules` defines that boundary, so a new flag for a new
 * service stays out of scope without an edit, while a new flag for a service we
 * do wrap fails `check` until someone decides about it.
 *
 * - `check` asserts the manifest covers every in-scope flag, names no flag that
 *   no longer exists, and agrees with `packages/examples/cdk.json` about which
 *   flags are set and to what. Cheap; wired into `npm run verify`.
 * - `audit` is the evidence behind the `no-effect` verdicts: it synthesises
 *   every example stack once per flag at that flag's recommended value and
 *   diffs the templates against the baseline. It checks the manifest's
 *   evidence-based claims — that a `no-effect` flag really changes nothing.
 *   Measured one flag at a time, so "no effect alone, effective once another is
 *   adopted" is out of its reach. `declined` is a judgement
 *   the templates cannot confirm (the two validation-report flags change a
 *   build gate, not a template), so it is not measured. Slow (one synth of the
 *   whole app per flag), so it is manual rather than part of `verify` — the same
 *   split as `cdk-floors establish` versus `cdk-floors check`.
 *
 * Usage:
 *   node scripts/cdk-flags.mjs check
 *   node scripts/cdk-flags.mjs audit          # requires a built examples package
 */

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FLAGS } from "aws-cdk-lib/cx-api";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "cdk-flags.json");
const PACKAGES = join(REPO_ROOT, "packages");
const EXAMPLES = join(PACKAGES, "examples");

/**
 * Valid statuses. `adopted` is the only one that means "set in
 * `packages/examples/cdk.json`", and so the only one that carries a `value`.
 */
const STATUSES = ["adopted", "declined", "no-effect"];

/**
 * Flags CDK still declares but removed in v2 — setting one throws "Unsupported
 * feature flag". They need no decision, and the absence of a v2 release is how
 * CDK marks them, so they are derived rather than listed.
 */
function removedInV2(flag) {
  return FLAGS[flag].introducedIn?.v2 === undefined;
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function exampleContext() {
  return JSON.parse(readFileSync(join(EXAMPLES, "cdk.json"), "utf8")).context ?? {};
}

/**
 * The aws-cdk-lib module a flag belongs to. Flag names are
 * `@aws-cdk/<module>:<name>`, with two spellings that break the pattern: the
 * `@aws-cdk-containers/` scope, and the unscoped `aws-cdk:` CLI flags.
 */
function moduleOf(flag) {
  return flag.replace(/^@aws-cdk[^/]*\//, "").split(":")[0];
}

/** CDK module -> the package that wraps it, inverted from the manifest. */
function packageByModule(modules) {
  return new Map(
    Object.entries(modules).flatMap(([pkg, cdkModules]) => cdkModules.map((m) => [m, pkg])),
  );
}

/**
 * A module or package name reduced to letters and digits, so CDK's inconsistent
 * spellings collapse onto one key. CDK ships both `@aws-cdk/customresources:`
 * and `@aws-cdk/custom-resources:`; listing one silently leaves the other out of
 * scope, which is the hole this tool exists to close — so `check` looks for it.
 */
function normalise(name) {
  return name
    .replace(/^aws-/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function check() {
  const { modules, flags, statusReasons } = readManifest();
  const context = exampleContext();
  const problems = [];
  const owner = packageByModule(modules);

  const cdkFlags = Object.keys(FLAGS);
  const scoped = cdkFlags.filter((flag) => owner.has(moduleOf(flag)) && !removedInV2(flag));

  // Every package declares the CDK modules it wraps, even when that is none, so
  // adding a package for a new service cannot quietly leave its flags unreviewed.
  const dirs = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const dir of dirs) {
    if (!Object.hasOwn(modules, dir)) {
      problems.push(
        `  modules: packages/${dir} has no entry. List the aws-cdk-lib modules it wraps, or [] if it wraps none.`,
      );
    }
  }
  for (const pkg of Object.keys(modules)) {
    if (!dirs.includes(pkg)) problems.push(`  modules.${pkg}: no such package "packages/${pkg}"`);
  }

  // A module CDK spells differently from the ones a package listed sits out of
  // scope unnoticed, so anything whose normalised name matches a package we ship
  // has to be a decision rather than an omission.
  const packagesByName = new Map(dirs.map((p) => [normalise(p), p]));
  for (const module of new Set(cdkFlags.map(moduleOf))) {
    if (owner.has(module)) continue;
    const pkg = packagesByName.get(normalise(module));
    if (pkg) {
      problems.push(
        `  modules.${pkg}: does not list CDK module "${module}", so its flags are out of scope — but the names match.\n` +
          `      CDK spells some modules more than one way. Add it, or say why the match is a coincidence.`,
      );
    }
  }

  for (const flag of scoped) {
    if (!Object.hasOwn(flags, flag)) {
      problems.push(
        `  ${flag}: aws-cdk-lib ships this flag for packages/${owner.get(moduleOf(flag))}, and the manifest has no entry.\n` +
          `      Recommended value is ${JSON.stringify(FLAGS[flag].recommendedValue)}. Decide, then add it.`,
      );
    }
  }

  for (const [flag, entry] of Object.entries(flags)) {
    if (!STATUSES.includes(entry.status)) {
      problems.push(
        `  ${flag}: unknown status ${JSON.stringify(entry.status)} (expected one of ${STATUSES.join(", ")})`,
      );
      continue;
    }
    if (!Object.hasOwn(FLAGS, flag)) {
      problems.push(
        `  ${flag}: manifest names a flag aws-cdk-lib no longer ships — drop the entry`,
      );
      continue;
    }
    if (!owner.has(moduleOf(flag))) {
      problems.push(
        `  ${flag}: no package lists CDK module "${moduleOf(flag)}", so the flag is out of scope — drop the entry or add the module`,
      );
    }
    if (removedInV2(flag)) {
      problems.push(
        `  ${flag}: CDK removed this flag in v2, so it needs no decision — drop the entry`,
      );
    }
    if (JSON.stringify(entry.recommended) !== JSON.stringify(FLAGS[flag].recommendedValue)) {
      problems.push(
        `  ${flag}: CDK now recommends ${JSON.stringify(FLAGS[flag].recommendedValue)}, the entry was decided against ${JSON.stringify(entry.recommended)} — re-decide`,
      );
    }
    if (!(entry.because ?? statusReasons[entry.status])) {
      problems.push(`  ${flag}: no "because" — the reason is the point of the manifest`);
    }

    const adopted = entry.status === "adopted";
    if (adopted && entry.value === undefined) {
      problems.push(`  ${flag}: status "adopted" requires a "value"`);
    }
    if (!adopted && entry.value !== undefined) {
      problems.push(`  ${flag}: status "${entry.status}" must not carry a "value" — it is not set`);
    }

    const isSet = Object.hasOwn(context, flag);
    if (adopted && !isSet) {
      problems.push(`  ${flag}: manifest adopts it, packages/examples/cdk.json does not set it`);
    } else if (!adopted && isSet) {
      problems.push(
        `  ${flag}: packages/examples/cdk.json sets it, manifest says "${entry.status}"`,
      );
    } else if (adopted && JSON.stringify(context[flag]) !== JSON.stringify(entry.value)) {
      problems.push(
        `  ${flag}: cdk.json has ${JSON.stringify(context[flag])}, manifest expects ${JSON.stringify(entry.value)}`,
      );
    }
  }

  // cdk.json's context is a general-purpose bag, so only keys that are actually
  // feature flags are the manifest's business.
  for (const flag of Object.keys(context)) {
    if (Object.hasOwn(FLAGS, flag) && !Object.hasOwn(flags, flag)) {
      problems.push(`  ${flag}: packages/examples/cdk.json sets it, manifest has no entry`);
    }
  }

  if (problems.length > 0) {
    console.error(`cdk-flags check failed:\n${problems.join("\n")}`);
    process.exit(1);
  }

  const counts = {};
  for (const { status } of Object.values(flags)) counts[status] = (counts[status] ?? 0) + 1;
  const summary = STATUSES.filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  console.log(
    `cdk-flags check passed (${scoped.length} in-scope flags of ${cdkFlags.length}: ${summary})`,
  );
}

async function audit() {
  const { modules, flags } = readManifest();
  // The static-website example stages an asset by a path relative to the
  // package, so synthesis has to run from there.
  process.chdir(EXAMPLES);
  const load = (file) => import(pathToFileURL(join(EXAMPLES, file)).href);
  const { buildExampleApp } = await load("dist/src/apps.js");
  const { exampleApp } = await load("dist/src/app-context.js");

  // One full assembly per flag, so clear the tree rather than accumulating
  // fifty stale copies across runs.
  const root = join(EXAMPLES, "cdk.out", "flag-audit");
  rmSync(root, { recursive: true, force: true });

  const templates = (context, tag) => {
    const assembly = buildExampleApp(exampleApp({ outdir: join(root, tag), context })).synth();
    return new Map(assembly.stacks.map((s) => [s.stackName, JSON.stringify(s.template)]));
  };

  // `exampleApp` merges EXAMPLE_CONTEXT, so this baseline is the posture the
  // examples actually deploy with — adopted flags included — not an empty
  // context. A flag's measured effect is its effect on what CI ships.
  const baseline = templates({}, "baseline");
  const disagreements = [];
  const owner = packageByModule(modules);
  const scoped = Object.keys(FLAGS).filter(
    (flag) => owner.has(moduleOf(flag)) && !removedInV2(flag),
  );

  for (const flag of scoped) {
    const entry = flags[flag];
    if (!entry) continue; // `check` reports missing entries; do not duplicate it here.
    // Only the evidence-based claims are checkable. "declined" is a decision,
    // and a flag can be declined for reasons the templates cannot show — both
    // of the validation-report flags change a build gate, not a template.
    if (entry.status === "adopted" || entry.status === "declined") continue;

    let changed;
    try {
      const after = templates({ [flag]: FLAGS[flag].recommendedValue }, normalise(flag));
      changed = [...new Set([...baseline.keys(), ...after.keys()])].filter(
        (name) => baseline.get(name) !== after.get(name),
      );
    } catch (error) {
      disagreements.push(
        `  ${flag}: status "${entry.status}", but setting it throws — ${error.message.split("\n")[0]}`,
      );
      continue;
    }

    if (entry.status === "no-effect" && changed.length > 0) {
      disagreements.push(
        `  ${flag}: status "no-effect", but it changes ${changed.length} stack(s): ${changed.join(", ")}`,
      );
    }
  }

  if (disagreements.length > 0) {
    console.error(
      `cdk-flags audit found ${disagreements.length} manifest claim(s) the templates disagree with:\n${disagreements.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `cdk-flags audit passed (${scoped.length} in-scope flags measured against the examples)`,
  );
}

const modes = { check, audit };
const mode = process.argv[2] ?? "";

if (!Object.hasOwn(modes, mode)) {
  console.error(
    `Unknown mode "${mode}". Usage: node scripts/cdk-flags.mjs <${Object.keys(modes).join("|")}>`,
  );
  process.exit(1);
}
await modes[mode]();
