import { rule } from "../../src/rules/lifecycle-build-must-forward-context.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("lifecycle-build-must-forward-context", rule, {
  valid: [
    {
      name: "context forwarded as the third argument",
      code: `const r = subBuilder.build(scope, id, context);`,
    },
    {
      name: "context forwarded from a helper's own parameter",
      code: `
        function resolveAccessLogs(scope: object, id: string, cfg: unknown, context?: object) {
          return subBuilder.build(scope, \`\${id}AccessLogs\`, context).bucket;
        }
      `,
    },
    {
      name: "zero-argument build() is not a Lifecycle build (e.g. StatementBuilder)",
      code: `const statements = items.map((s) => s.build());`,
    },
    {
      name: "single-argument build() is not a Lifecycle build",
      code: `const doc = policy.build(statements);`,
    },
    {
      name: "spread forwarding wrapper passes context through by construction",
      code: `const result = target.build(...args);`,
    },
    {
      name: "a build method declaration is not a call",
      code: `
        class Foo {
          build(scope: object, id: string) {
            return { id };
          }
        }
      `,
    },
    {
      name: "an unrelated two-argument call is untouched",
      code: `const x = thing.construct(scope, id);`,
    },
    {
      name: "computed member access is not matched",
      code: `const x = thing["build"](scope, id);`,
    },
  ],
  invalid: [
    {
      name: "sub-builder built without context inside a builder's build method",
      code: `
        class VpcBuilder {
          build(scope: object, id: string, context?: Record<string, object>) {
            return createLogGroupBuilder().build(scope, id + "FlowLogs").logGroup;
          }
        }
      `,
      errors: [{ messageId: "missingContext" }],
    },
    {
      name: "sub-builder built without context inside a free helper function",
      code: `
        function resolveAccessLogs(scope: object, id: string, cfg: unknown) {
          return subBuilder.build(scope, \`\${id}AccessLogs\`).bucket;
        }
      `,
      errors: [{ messageId: "missingContext" }],
    },
    {
      name: "chained sub-builder build without context",
      code: `
        const sg = createSecurityGroupBuilder()
          .vpc(resolvedVpc)
          .build(scope, \`\${id}Sg\`).securityGroup;
      `,
      errors: [{ messageId: "missingContext" }],
    },
    {
      name: "each dropped call site is reported separately",
      code: `
        function twoSites(scope: object, id: string) {
          const a = first.build(scope, id);
          const b = second.build(scope, id);
          return [a, b];
        }
      `,
      errors: [{ messageId: "missingContext" }, { messageId: "missingContext" }],
    },
  ],
});
