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
        // nx runs three packages at once and each vitest sizes its own fork
        // pool to the CPU count, so a 4-vCPU CI runner oversubscribes badly:
        // 20ms tests have timed out at vitest's 5s default on a green tree.
        testTimeout: 20_000,
        env: {
          // aws-cdk-lib >= 2.262.0 validates every synth against a default
          // ruleset: ~600ms vs ~15ms, and these suites assert on synth output
          // directly. Only off switch — the flag in the warning just escalates.
          CDK_VALIDATION: "false",
        },
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
