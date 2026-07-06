import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

// perFile: true fails an individual file that dips below the thresholds on
// its own, rather than diluting it into a package-wide average — a new
// builder shipped with no test shows up as 0% and fails immediately.
export function withCoverage(
  thresholds: CoverageThresholds,
  config: ViteUserConfig = {},
): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      test: {
        coverage: {
          provider: "v8",
          enabled: true,
          // text: local console. json-summary: machine-readable per-package
          // totals at coverage/coverage-summary.json, merged by
          // scripts/coverage-summary.mjs into the CI PR comment + job summary.
          reporter: ["text", "json-summary"],
          thresholds: {
            ...thresholds,
            perFile: true,
          },
        },
      },
    }),
    config,
  );
}
