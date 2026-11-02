import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, describe, it } from "node:test";
import { netNewAdvisories } from "./net-new-advisories.mjs";

const advisory = (ghsa, severity = "moderate") => ({
  severity,
  advisory_ghsa_id: ghsa,
  advisory_summary: `${ghsa} summary`,
  advisory_url: `https://github.com/advisories/${ghsa}`,
});

const change = (change_type, name, version, ...vulnerabilities) => ({
  change_type,
  manifest: "package-lock.json",
  name,
  version,
  vulnerabilities,
});

const added = (...args) => change("added", ...args);
const removed = (...args) => change("removed", ...args);
const ids = (changes, allowed) => netNewAdvisories(changes, allowed).map(({ ghsa }) => ghsa);

describe("netNewAdvisories", () => {
  it("passes a bump between versions with the same advisory", () => {
    const changes = [
      removed("minimatch", "10.2.5", advisory("GHSA-a")),
      added("minimatch", "10.2.6", advisory("GHSA-a")),
    ];
    assert.deepEqual(ids(changes), []);
  });

  it("fails a bump to a version with a different advisory", () => {
    const changes = [
      removed("minimatch", "10.2.5", advisory("GHSA-a")),
      added("minimatch", "10.2.6", advisory("GHSA-a"), advisory("GHSA-b")),
    ];
    assert.deepEqual(ids(changes), ["GHSA-b"]);
  });

  it("fails an added version with an advisory when nothing was removed", () => {
    assert.deepEqual(ids([added("axios", "1.0.0", advisory("GHSA-a"))]), ["GHSA-a"]);
  });

  it("gives no credit for a closed advisory against a new one", () => {
    const changes = [
      removed("axios", "1.0.0", advisory("GHSA-a", "critical")),
      added("axios", "1.1.0", advisory("GHSA-b")),
    ];
    assert.deepEqual(ids(changes), ["GHSA-b"]);
  });

  it("does not let one package's removal excuse the advisory on another", () => {
    const changes = [
      removed("minimatch", "10.2.5", advisory("GHSA-a")),
      added("other", "1.0.0", advisory("GHSA-a")),
    ];
    assert.deepEqual(ids(changes), ["GHSA-a"]);
  });

  it("passes removals and changes with no advisory", () => {
    const changes = [removed("axios", "1.0.0", advisory("GHSA-a")), added("axios", "1.1.0")];
    assert.deepEqual(ids(changes), []);
  });

  it("ignores low severity and fails everything above it", () => {
    const changes = ["low", "moderate", "high", "critical"].map((severity) =>
      added(severity, "1.0.0", advisory(`GHSA-${severity}`, severity)),
    );
    assert.deepEqual(ids(changes), ["GHSA-moderate", "GHSA-high", "GHSA-critical"]);
  });

  it("fails an unrecognised severity", () => {
    assert.deepEqual(ids([added("axios", "1.0.0", advisory("GHSA-a", "dire"))]), ["GHSA-a"]);
  });

  it("counts development dependencies the same as runtime ones", () => {
    const dev = { ...added("axios", "1.0.0", advisory("GHSA-a")), scope: "development" };
    assert.deepEqual(ids([dev]), ["GHSA-a"]);
  });

  it("skips allowed advisories", () => {
    const changes = [added("axios", "1.0.0", advisory("GHSA-a"), advisory("GHSA-b"))];
    assert.deepEqual(ids(changes, new Set(["GHSA-a"])), ["GHSA-b"]);
  });

  it("throws on an entry it doesn't understand", () => {
    for (const bad of [{ message: "error" }, { change_type: "added" }, null]) {
      assert.throws(() => netNewAdvisories([bad]), /Unexpected dependency change/);
    }
  });
});

describe("dependency-review.mjs", () => {
  const script = join(import.meta.dirname, "dependency-review.mjs");
  const bin = mkdtempSync(join(tmpdir(), "dependency-review-"));
  after(() => rmSync(bin, { recursive: true, force: true }));

  const gh = join(bin, "gh");
  writeFileSync(gh, '#!/bin/sh\nprintf %s "$FAKE_GH_STDOUT"\nexit "$FAKE_GH_STATUS"\n');
  chmodSync(gh, 0o755);

  /** Runs the script with a stand-in `gh` that prints `stdout` and exits `status`. */
  function run(stdout, status = 0, env = { BASE_SHA: "base", HEAD_SHA: "head" }) {
    return spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "owner/name",
        FAKE_GH_STDOUT: stdout,
        FAKE_GH_STATUS: String(status),
        ...env,
      },
    });
  }

  it("passes when the PR changes no dependencies", () => {
    assert.equal(run("[[]]").status, 0);
  });

  it("reads every page", () => {
    const pages = [
      [removed("minimatch", "10.2.5", advisory("GHSA-a"))],
      [added("minimatch", "10.2.6", advisory("GHSA-a"))],
    ];
    assert.equal(run(JSON.stringify(pages)).status, 0);
  });

  it("fails and names the advisory when one is net-new", () => {
    const { status, stderr } = run(JSON.stringify([[added("axios", "1.0.0", advisory("GHSA-a"))]]));
    assert.equal(status, 1);
    assert.match(stderr, /::error::package-lock\.json » axios@1\.0\.0 adds GHSA-a \(moderate\)/);
  });

  it("fails when gh fails", () => {
    assert.notEqual(run("[[]]", 1).status, 0);
  });

  it("fails on output it can't parse", () => {
    assert.notEqual(run("not json").status, 0);
  });

  it("fails when a required variable is missing", () => {
    assert.notEqual(run("[[]]", 0, { BASE_SHA: "base" }).status, 0);
  });
});
