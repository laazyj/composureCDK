import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 0,
  branches: 0,
  functions: 0,
  lines: 0,
});
