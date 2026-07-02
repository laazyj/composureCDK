import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 75,
  branches: 70,
  functions: 68,
  lines: 75,
});
