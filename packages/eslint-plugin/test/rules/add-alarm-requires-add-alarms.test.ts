import { rule } from "../../src/rules/add-alarm-requires-add-alarms.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("add-alarm-requires-add-alarms", rule, {
  valid: [
    {
      name: "addAlarm with addAlarms",
      code: `
        class QueueBuilder {
          addAlarm(key, configure) { return this; }
          addAlarms(alarms) { return this; }
        }
      `,
    },
    {
      name: "neither method",
      code: `class QueueBuilder { build() {} }`,
    },
    {
      name: "a property named addAlarm is not a method declaration",
      code: `class QueueBuilder { addAlarm = () => this; }`,
    },
    {
      name: "a computed key is not matched by name",
      code: `const k = "addAlarm"; class QueueBuilder { [k]() { return this; } }`,
    },
  ],
  invalid: [
    {
      name: "class declaration with addAlarm only",
      code: `
        class QueueBuilder {
          addAlarm(key, configure) { return this; }
        }
      `,
      errors: [{ messageId: "missingAddAlarms", data: { className: "QueueBuilder" } }],
    },
    {
      name: "anonymous class expression with addAlarm only",
      code: `export default class { addAlarm(key, configure) { return this; } }`,
      errors: [{ messageId: "missingAddAlarms", data: { className: "This class" } }],
    },
  ],
});
