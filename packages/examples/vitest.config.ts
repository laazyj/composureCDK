import { defineConfig } from "vitest/config";
import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(
  defineConfig({
    test: {
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
  {
    statements: 86,
    branches: 65,
    functions: 100,
    lines: 97,
  },
);
