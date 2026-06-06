import type { Rule } from "eslint";
import type { CallExpression, Expression, Pattern, Property } from "estree";

/**
 * Requires every `stringConstraint({ ... })` call to set a non-empty `name`,
 * `allowed`, and `source`. These three fields are what make a synth-time
 * validation error useful — it names the property, lists the allowed character
 * set, and links the AWS doc (ADR-0009).
 *
 * The factory's type already makes the keys required, so this rule's real job
 * is the part the type checker cannot see: a present-but-empty string literal
 * (`allowed: ""`) compiles fine yet silently degrades every error message the
 * constraint produces. Non-literal values (e.g. `allowed: SG_ALLOWED`) are
 * left alone — their contents aren't statically knowable.
 *
 * The rule keys on the `stringConstraint` callee name (unique to the catalogue
 * mechanism); a call that spreads another object is skipped to avoid false
 * positives.
 */
const REQUIRED_FIELDS = ["name", "allowed", "source"] as const;

function propertyKey(property: Property): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return undefined;
}

function isEmptyStringLiteral(value: Expression | Pattern): boolean {
  return value.type === "Literal" && typeof value.value === "string" && value.value.trim() === "";
}

export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "stringConstraint() must set a non-empty name, allowed, and source so every validation error names the allowed set and links the AWS doc",
    },
    schema: [],
    messages: {
      missingField:
        "stringConstraint() is missing required `{{field}}`. Every catalogue entry must set " +
        "name, allowed, and source (ADR-0009) so synth-time errors name the allowed set and link the AWS doc.",
      emptyField:
        "stringConstraint() `{{field}}` is empty. It is surfaced verbatim in the validation " +
        "error message (ADR-0009) — give it a meaningful value.",
    },
  },
  create(ctx) {
    return {
      CallExpression(node: CallExpression) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "stringConstraint") {
          return;
        }
        if (node.arguments.length === 0) return;
        const arg = node.arguments[0];
        if (arg.type !== "ObjectExpression") return;

        // A spread could supply any of the required fields — can't verify statically.
        if (arg.properties.some((p) => p.type === "SpreadElement")) return;

        const values = new Map<string, Expression | Pattern>();
        for (const property of arg.properties) {
          if (property.type !== "Property") continue;
          const key = propertyKey(property);
          if (key !== undefined) values.set(key, property.value);
        }

        for (const field of REQUIRED_FIELDS) {
          const value = values.get(field);
          if (value === undefined) {
            ctx.report({ node, messageId: "missingField", data: { field } });
          } else if (isEmptyStringLiteral(value)) {
            ctx.report({ node: value, messageId: "emptyField", data: { field } });
          }
        }
      },
    };
  },
};
