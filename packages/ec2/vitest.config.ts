import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 84,
  branches: 66,
  functions: 75,
  lines: 94,
});
