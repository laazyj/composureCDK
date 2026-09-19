import { rule } from "../../src/rules/no-typescript-private-modifier.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("no-typescript-private-modifier", rule, {
  valid: [
    {
      name: "ECMAScript private field",
      code: `
        class Builder {
          #props = {};
        }
      `,
    },
    {
      name: "ECMAScript private method",
      code: `
        class Builder {
          #clone() {
            return this;
          }
        }
      `,
    },
    {
      name: "private constructor — #constructor is not valid syntax",
      code: `
        class Builder {
          private constructor() {}
        }
      `,
    },
    {
      name: "public and protected members are not this rule's business",
      code: `
        class Builder {
          public name = "x";
          protected kind = "y";
          readonly id = "z";
          protected build() {}
        }
      `,
    },
    {
      name: "a non-accessibility parameter property",
      code: `
        class Builder {
          constructor(readonly scope: object) {}
        }
      `,
    },
  ],
  invalid: [
    {
      name: "private property",
      code: `
        class Builder {
          private props = {};
        }
      `,
      errors: [{ messageId: "property", data: { name: "props" } }],
    },
    {
      name: "private method",
      code: `
        class Builder {
          private clone() {
            return this;
          }
        }
      `,
      errors: [{ messageId: "method", data: { name: "clone" } }],
    },
    {
      name: "private getter",
      code: `
        class Builder {
          private get arn() {
            return "";
          }
        }
      `,
      errors: [{ messageId: "method", data: { name: "arn" } }],
    },
    {
      name: "private parameter property",
      code: `
        class Builder {
          constructor(private scope: object) {}
        }
      `,
      errors: [{ messageId: "parameterProperty", data: { name: "scope" } }],
    },
    {
      name: "private accessor field — a distinct node, same leak",
      code: `
        class Builder {
          private accessor arn = "";
        }
      `,
      errors: [{ messageId: "property", data: { name: "arn" } }],
    },
    {
      name: "string-literal key is named in the message",
      code: `
        class Builder {
          private "bucket-arn" = "";
        }
      `,
      errors: [{ messageId: "property", data: { name: "bucket-arn" } }],
    },
    {
      name: "computed key has no name to suggest",
      code: `
        const key = "arn";
        class Builder {
          private [key] = "";
        }
      `,
      errors: [{ messageId: "property", data: { name: "field" } }],
    },
    {
      name: "defaulted parameter property is named through its default",
      code: `
        class Builder {
          constructor(private scope: object = {}) {}
        }
      `,
      errors: [{ messageId: "parameterProperty", data: { name: "scope" } }],
    },
    {
      name: "every private member is reported, not just the first",
      code: `
        class Builder {
          private props = {};
          private alarms = [];
          private clone() {
            return this;
          }
        }
      `,
      errors: [
        { messageId: "property", data: { name: "props" } },
        { messageId: "property", data: { name: "alarms" } },
        { messageId: "method", data: { name: "clone" } },
      ],
    },
  ],
});
