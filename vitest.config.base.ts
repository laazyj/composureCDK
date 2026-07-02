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
  config: ViteUserConfig,
  thresholds: CoverageThresholds,
  overrides: Record<string, Partial<CoverageThresholds>> = {},
): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      test: {
        coverage: {
          provider: "v8",
          enabled: true,
          reporter: ["text", "html"],
          thresholds: {
            ...thresholds,
            perFile: true,
            ...overrides,
          },
        },
      },
    }),
    config,
  );
}
