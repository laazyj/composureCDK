import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 90,
  branches: 85,
  functions: 100,
  lines: 97,
});
