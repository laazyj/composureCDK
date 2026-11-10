import type { Rule } from "eslint";
import type { ClassBody, MethodDefinition } from "estree";

/** Matches a method declared with the plain (non-computed) identifier `name`. */
const isMethod =
  (name: string) =>
  (member: ClassBody["body"][number]): member is MethodDefinition =>
    member.type === "MethodDefinition" &&
    member.kind === "method" &&
    !member.computed &&
    member.key.type === "Identifier" &&
    member.key.name === name;

/**
 * Flags a class that declares `addAlarm` without the batch `addAlarms` beside it.
 *
 * Every builder with `addAlarm(key, configure)` also offers
 * `addAlarms(alarms)`, so an app can add a whole alarm set in one step of the
 * chain. A builder that gains the first without the second makes that API
 * uneven, and nothing else would notice.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/add-alarm-requires-add-alarms.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "A class that declares `addAlarm` must also declare `addAlarms`.",
    },
    schema: [],
    messages: {
      missingAddAlarms:
        "`{{className}}` declares `addAlarm` but not `addAlarms`. Add " +
        "`addAlarms(alarms: Record<string, AlarmConfigurer<T>>): this` that calls " +
        "`this.addAlarm(key, configure)` for each entry, so an alarm set can be added in one step.",
    },
  },
  create(ctx) {
    return {
      ClassBody(node) {
        const addAlarm = node.body.find(isMethod("addAlarm"));
        if (!addAlarm || node.body.some(isMethod("addAlarms"))) return;

        const parent = node.parent;
        const className =
          (parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && parent.id
            ? parent.id.name
            : "This class";
        ctx.report({ node: addAlarm.key, messageId: "missingAddAlarms", data: { className } });
      },
    };
  },
};
