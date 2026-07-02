import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 96,
  branches: 93,
  functions: 100,
  lines: 100,
});
