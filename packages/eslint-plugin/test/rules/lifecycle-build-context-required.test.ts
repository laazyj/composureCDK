import { rule } from "../../src/rules/lifecycle-build-context-required.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("lifecycle-build-context-required", rule, {
  valid: [
    {
      name: "no Resolvable usage in class body",
      code: `
        class Foo {
          build(scope: object, id: string) {
            return { id };
          }
        }
      `,
    },
    {
      name: "build accepts a context parameter (third position)",
      code: `
        class Foo {
          props: { ref?: Resolvable<string> } = {};
          build(scope: object, id: string, context?: Record<string, object>) {
            return { id, context };
          }
        }
      `,
    },
    {
      name: "no build method at all",
      code: `
        class Foo {
          ref?: Resolvable<string>;
        }
      `,
    },
  ],
  invalid: [
    {
      name: "uses Resolvable<...> but build has no context param",
      code: `
        class Foo {
          ref?: Resolvable<string>;
          build(scope: object, id: string) {
            return { id };
          }
        }
      `,
      errors: [{ messageId: "missingContext" }],
    },
    {
      name: "Resolvable<...> in nested type position still flagged",
      code: `
        class Foo {
          props: { refs?: Array<Resolvable<string>> } = {};
          build(scope: object, id: string) {
            return { id };
          }
        }
      `,
      errors: [{ messageId: "missingContext" }],
    },
  ],
});
