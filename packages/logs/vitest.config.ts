import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
});
