import { rule } from "../../src/rules/error-name-matches-class.js";
import { ruleTester } from "../rule-tester.js";

const NOTE = "/** Catch this by `name`, not `instanceof`. */";

ruleTester.run("error-name-matches-class", rule, {
  valid: [
    {
      name: "exported error setting name in its constructor, with the note",
      code: `
        ${NOTE}
        export class WidgetError extends Error {
          constructor() { super("x"); this.name = "WidgetError"; }
        }
      `,
    },
    {
      name: "name set by a class field",
      code: `
        ${NOTE}
        export class WidgetError extends Error {
          override readonly name = "WidgetError";
        }
      `,
    },
    {
      name: "name set through a TS wrapper",
      code: `
        ${NOTE}
        export class WidgetError extends Error {
          constructor() { super("x"); this.name = "WidgetError" as const; }
        }
      `,
    },
    {
      name: "subclass of another error",
      code: `
        ${NOTE}
        export class NarrowError extends WidgetError {
          constructor() { super(); this.name = "NarrowError"; }
        }
      `,
    },
    {
      name: "a non-exported error needs no note",
      code: `class LocalError extends Error { constructor() { super(); this.name = "LocalError"; } }`,
    },
    {
      name: "a class that does not extend an error is ignored",
      code: `export class Widget extends Base {}`,
    },
    {
      name: "an anonymous class is ignored",
      code: `const E = class extends Error {};`,
    },
  ],
  invalid: [
    {
      name: "no name set",
      code: `
        ${NOTE}
        export class WidgetError extends Error {
          constructor() { super("x"); }
        }
      `,
      errors: [
        { messageId: "missingName", data: { className: "WidgetError", superName: "Error" } },
      ],
    },
    {
      name: "name set to another string",
      code: `
        ${NOTE}
        export class WidgetError extends Error {
          constructor() { super("x"); this.name = "Widget"; }
        }
      `,
      errors: [
        { messageId: "missingName", data: { className: "WidgetError", superName: "Error" } },
      ],
    },
    {
      name: "a subclass that keeps its parent's name",
      code: `
        ${NOTE}
        export class NarrowError extends WidgetError {}
      `,
      errors: [
        { messageId: "missingName", data: { className: "NarrowError", superName: "WidgetError" } },
      ],
    },
    {
      name: "exported without the note",
      code: `
        /** Thrown when a widget is wrong. */
        export class WidgetError extends Error {
          constructor() { super("x"); this.name = "WidgetError"; }
        }
      `,
      errors: [{ messageId: "missingCatchByNameNote", data: { className: "WidgetError" } }],
    },
    {
      name: "exported with no TSDoc at all",
      code: `
        export default class WidgetError extends Error {
          constructor() { super("x"); this.name = "WidgetError"; }
        }
      `,
      errors: [{ messageId: "missingCatchByNameNote", data: { className: "WidgetError" } }],
    },
  ],
});
