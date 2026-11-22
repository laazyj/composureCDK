import { rule } from "../../src/rules/constraint-metadata-required.js";
import { ruleTester } from "../rule-tester.js";

const IMPORT = `import { stringConstraint } from "@composurecdk/cloudformation";\n`;

ruleTester.run("constraint-metadata-required", rule, {
  valid: [
    {
      name: "stringConstraint with name, allowed, and source as literals",
      code: `${IMPORT}
        const C = stringConstraint({
          name: "EC2 SecurityGroup GroupDescription",
          charClass: "A-Za-z0-9",
          maxLength: 255,
          allowed: "ASCII letters and digits",
          source: "https://docs.aws.amazon.com/x",
        });
      `,
    },
    {
      name: "non-literal field values are left alone (contents not statically knowable)",
      code: `${IMPORT}
        const C = stringConstraint({
          name: "Tag key",
          charClass: TAG_CHARS,
          allowed: TAG_ALLOWED,
          source: TAG_SOURCE,
        });
      `,
    },
    {
      name: "ignores a stringConstraint the project defines itself",
      code: `
        function stringConstraint(spec: object) { return spec; }
        const C = stringConstraint({ charClass: "A-Za-z0-9" });
      `,
    },
    {
      name: "ignores a stringConstraint imported from anywhere else",
      code: `
        import { stringConstraint } from "./my-constraints.js";
        const C = stringConstraint({ charClass: "A-Za-z0-9" });
      `,
    },
    {
      name: "ignores another export imported under the factory's name",
      code: `
        import { validateString as stringConstraint } from "@composurecdk/cloudformation";
        const C = stringConstraint({ charClass: "A-Za-z0-9" });
      `,
    },
    {
      name: "ignores a default import from the package",
      code: `
        import stringConstraint from "@composurecdk/cloudformation";
        const C = stringConstraint({ charClass: "A-Za-z0-9" });
      `,
    },
    {
      name: "reads quoted keys, and leaves computed keys alone",
      code: `${IMPORT}
        const C = stringConstraint({ "name": "Tag key", allowed: "x", ["source"]: "y", source: "z" });
      `,
    },
    {
      name: "ignores unrelated call expressions",
      code: `const x = someOtherFactory({ foo: 1 });`,
    },
    {
      name: "skips calls that spread another object (not statically analysable)",
      code: `${IMPORT}const C = stringConstraint({ ...base, name: "x" });`,
    },
  ],
  invalid: [
    {
      name: "checks the factory imported under a string name",
      code: `
        import { "stringConstraint" as sc } from "@composurecdk/cloudformation";
        const C = sc({ name: "Tag key", charClass: "A-Za-z0-9", allowed: "x" });
      `,
      errors: [{ messageId: "missingField" }],
    },
    {
      name: "missing allowed and source",
      code: `${IMPORT}
        const C = stringConstraint({
          name: "Tag key",
          charClass: "A-Za-z0-9",
        });
      `,
      errors: [{ messageId: "missingField" }, { messageId: "missingField" }],
    },
    {
      name: "missing all three required fields",
      code: `${IMPORT}const C = stringConstraint({ charClass: "A-Za-z0-9" });`,
      errors: [
        { messageId: "missingField" },
        { messageId: "missingField" },
        { messageId: "missingField" },
      ],
    },
    {
      name: "present but empty allowed string degrades the error message",
      code: `${IMPORT}
        const C = stringConstraint({
          name: "Tag key",
          charClass: "A-Za-z0-9",
          allowed: "   ",
          source: "https://docs.aws.amazon.com/x",
        });
      `,
      errors: [{ messageId: "emptyField" }],
    },
  ],
});
