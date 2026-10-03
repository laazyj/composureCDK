import { withCoverage } from "../../vitest.config.base.js";

export default withCoverage(
  {
    statements: 100,
    branches: 100,
    functions: 100,
    lines: 100,
  },
  // No src/: the checks live at the package root. check.mjs, the command line
  // over them, is run as a child process and so cannot be measured.
  { test: { coverage: { include: ["checks.mjs"] } } },
);
