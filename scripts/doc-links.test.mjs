import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classifier } from "./doc-links.mjs";
import { published } from "./published-packages.mjs";

const BASE = "https://github.com/laazyj/composureCDK";
const core = published().find(({ manifest }) => manifest.name === "@composurecdk/core");
const readme = classifier(core, join(core.dir, "README.md"), BASE);
const testingDoc = classifier(core, join(core.dir, "docs", "testing.md"), BASE);

describe("classifier", () => {
  it("leaves external links, anchors and links to shipped files alone", () => {
    assert.equal(readme("https://example.com/x"), undefined);
    assert.equal(readme("#construct-ids"), undefined);
    assert.equal(readme("./docs/testing.md#x"), undefined);
  });

  it("rewrites a relative link that leaves the package as a GitHub URL", () => {
    assert.deepEqual(readme("../../docs/architecture.md#refs"), {
      replace: `${BASE}/blob/main/docs/architecture.md#refs`,
      reason: "leaves the published package",
    });
    assert.deepEqual(readme("../lambda"), {
      replace: `${BASE}/tree/main/packages/lambda`,
      reason: "leaves the published package",
    });
  });

  it("checks that a GitHub link to this repo still has a target", () => {
    assert.equal(readme(`${BASE}/blob/main/docs/architecture.md#refs`), undefined);
    assert.deepEqual(readme(`${BASE}/blob/main/docs/no-such-doc.md`), {
      error: "the link target does not exist",
    });
  });

  it("turns a GitHub link to a file the package ships back into a relative one", () => {
    assert.deepEqual(readme(`${BASE}/blob/main/packages/core/docs/testing.md#a`), {
      replace: "./docs/testing.md#a",
      reason: "points at a file the package ships",
    });
    assert.deepEqual(testingDoc(`${BASE}/blob/main/packages/core/README.md`), {
      replace: "../README.md",
      reason: "points at a file the package ships",
    });
  });

  it("reports a relative link whose target is missing", () => {
    assert.deepEqual(readme("./nope.md"), { error: "the link target does not exist" });
  });
});
