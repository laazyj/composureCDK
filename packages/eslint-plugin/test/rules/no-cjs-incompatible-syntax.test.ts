import { rule } from "../../src/rules/no-cjs-incompatible-syntax.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("no-cjs-incompatible-syntax", rule, {
  valid: [
    {
      name: "await inside an async function",
      code: `
        async function load() {
          return await Promise.resolve(1);
        }
      `,
    },
    {
      name: "await inside an async arrow function",
      code: `
        const load = async () => await Promise.resolve(1);
      `,
    },
    {
      name: "await inside a nested arrow passed to a top-level call",
      code: `
        const results = [1].map(async (x) => await Promise.resolve(x));
      `,
    },
    {
      name: "for await...of inside an async function",
      code: `
        async function drain(source) {
          for await (const item of source) {
            console.log(item);
          }
        }
      `,
    },
    {
      name: "no import.meta or await at all",
      code: `
        export const value = 42;
      `,
    },
  ],
  invalid: [
    {
      name: "import.meta usage",
      code: `
        export const dir = import.meta.url;
      `,
      errors: [{ messageId: "importMeta" }],
    },
    {
      name: "top-level await",
      code: `
        export const value = await Promise.resolve(1);
      `,
      errors: [{ messageId: "topLevelAwait" }],
    },
    {
      name: "top-level await is flagged even when an async function exists elsewhere",
      code: `
        async function unrelated() {
          return 1;
        }
        export const value = await Promise.resolve(1);
      `,
      errors: [{ messageId: "topLevelAwait" }],
    },
    {
      name: "top-level for await...of",
      code: `
        for await (const item of source) {
          console.log(item);
        }
      `,
      errors: [{ messageId: "topLevelAwait" }],
    },
  ],
});
