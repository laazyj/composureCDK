import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";
import { DUAL_PACKAGES } from "./dual-packages.js";

type ModuleSyntax = "commonjs" | "module";

/**
 * Spawns a fresh `node` that loads `pkg` with the given module syntax and
 * asserts `probe` is a defined export. A CommonJS load exercises the package's
 * `require` export condition; an ESM load exercises `import`.
 *
 * Throws (failing the test) if `node` exits non-zero — i.e. the package could
 * not be resolved or the export is missing. The child's stderr is surfaced so
 * the failure names the actual resolution error.
 */
function loadInChildNode(pkg: string, probe: string, syntax: ModuleSyntax): void {
  const load =
    syntax === "commonjs"
      ? `const m = require(${JSON.stringify(pkg)});`
      : `import * as m from ${JSON.stringify(pkg)};`;
  const assertion = `if (m[${JSON.stringify(probe)}] === undefined) throw new Error(${JSON.stringify(
    `"${pkg}" loaded but export "${probe}" is missing`,
  )});`;

  try {
    execFileSync(process.execPath, ["--input-type", syntax, "--eval", `${load} ${assertion}`], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 30_000,
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`${syntax} load of "${pkg}" failed:\n${stderr ?? String(error)}`, {
      cause: error,
    });
  }
}

describe.each(DUAL_PACKAGES)("$name", ({ name, probe }) => {
  it("resolves under ESM import", () => {
    loadInChildNode(name, probe, "module");
  });

  it("resolves under CommonJS require()", () => {
    loadInChildNode(name, probe, "commonjs");
  });
});
