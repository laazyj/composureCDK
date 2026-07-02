import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 95,
  branches: 92,
  functions: 100,
  lines: 95,
});
