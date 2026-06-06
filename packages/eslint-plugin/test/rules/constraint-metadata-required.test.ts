import { rule } from "../../src/rules/constraint-metadata-required.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("constraint-metadata-required", rule, {
  valid: [
    {
      name: "stringConstraint with name, allowed, and source as literals",
      code: `
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
      code: `
        const C = stringConstraint({
          name: "Tag key",
          charClass: TAG_CHARS,
          allowed: TAG_ALLOWED,
          source: TAG_SOURCE,
        });
      `,
    },
    {
      name: "ignores unrelated call expressions",
      code: `const x = someOtherFactory({ foo: 1 });`,
    },
    {
      name: "skips calls that spread another object (not statically analysable)",
      code: `const C = stringConstraint({ ...base, name: "x" });`,
    },
  ],
  invalid: [
    {
      name: "missing allowed and source",
      code: `
        const C = stringConstraint({
          name: "Tag key",
          charClass: "A-Za-z0-9",
        });
      `,
      errors: [{ messageId: "missingField" }, { messageId: "missingField" }],
    },
    {
      name: "missing all three required fields",
      code: `const C = stringConstraint({ charClass: "A-Za-z0-9" });`,
      errors: [
        { messageId: "missingField" },
        { messageId: "missingField" },
        { messageId: "missingField" },
      ],
    },
    {
      name: "present but empty allowed string degrades the error message",
      code: `
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
