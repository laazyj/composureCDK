import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(defineConfig({}), {
  statements: 94,
  branches: 90,
  functions: 100,
  lines: 95,
});
