import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 87,
  branches: 71,
  functions: 100,
  lines: 87,
});
