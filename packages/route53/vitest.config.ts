import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 83,
  branches: 66,
  functions: 100,
  lines: 83,
});
