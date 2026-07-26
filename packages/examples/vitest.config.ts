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
      env: {
        // Undo the base opt-out: these are whole applications, so the default
        // CloudFormation ruleset is meaningful here, unlike the builder suites'
        // throwaway fixtures. The flag makes findings throw instead of
        // scrolling past as warnings.
        CDK_VALIDATION: "true",
        CDK_CONTEXT_JSON: JSON.stringify({
          "@aws-cdk/core:validateAgainstDefaultRules": true,
        }),
      },
    },
  },
);
