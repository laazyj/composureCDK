import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(
  {
    statements: 86,
    branches: 65,
    functions: 100,
    lines: 97,
  },
  {
    test: {
      setupFiles: ["./vitest.setup.ts"],
    },
  },
);
