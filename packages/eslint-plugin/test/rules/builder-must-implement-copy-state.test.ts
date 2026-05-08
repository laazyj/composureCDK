import { rule } from "../../src/rules/builder-must-implement-copy-state.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("builder-must-implement-copy-state", rule, {
  valid: [
    {
      name: "no private fields",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder { props = {}; }
        export const create = () => Builder(MyBuilder);
      `,
    },
    {
      name: "private field with COPY_STATE hook",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          #state = new Map();
          [COPY_STATE](target) { target.#state = new Map(this.#state); }
        }
        export const create = () => Builder(MyBuilder);
      `,
    },
    {
      name: "private field with @copy-state: ignore -- justification",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          // @copy-state: ignore -- regenerated per build
          #cache = new Map();
        }
        export const create = () => Builder(MyBuilder);
      `,
    },
    {
      name: "class never passed to Builder/taggedBuilder is not checked",
      code: `
        class Plain { #state = 1; }
      `,
    },
    {
      name: "taggedBuilder factory also satisfies the rule",
      code: `
        import { taggedBuilder } from "@composurecdk/cloudformation";
        class MyBuilder {
          #state = 1;
          [COPY_STATE](target) { target.#state = this.#state; }
        }
        export const create = () => taggedBuilder(MyBuilder);
      `,
    },
  ],
  invalid: [
    {
      name: "private field without hook",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          #state = new Map();
        }
        export const create = () => Builder(MyBuilder);
      `,
      errors: [{ messageId: "missingHook", data: { className: "MyBuilder", fields: "#state" } }],
    },
    {
      name: "multiple private fields, no hook — all listed",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          #a = 1;
          #b = 2;
        }
        export const create = () => Builder(MyBuilder);
      `,
      errors: [{ messageId: "missingHook", data: { className: "MyBuilder", fields: "#a, #b" } }],
    },
    {
      name: "@copy-state: ignore without justification",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          // @copy-state: ignore
          #cache = new Map();
        }
        export const create = () => Builder(MyBuilder);
      `,
      errors: [{ messageId: "ignoreMarkerNeedsJustification", data: { field: "#cache" } }],
    },
    {
      name: "@copy-state: ignore -- (empty justification) still flagged",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {
          // @copy-state: ignore --
          #cache = new Map();
        }
        export const create = () => Builder(MyBuilder);
      `,
      errors: [{ messageId: "ignoreMarkerNeedsJustification", data: { field: "#cache" } }],
    },
  ],
});
