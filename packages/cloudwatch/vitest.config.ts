import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 90,
  branches: 83,
  functions: 100,
  lines: 90,
});
