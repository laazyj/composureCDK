import type { Rule } from "eslint";
import type { CallExpression, Expression, Pattern, Program, Property } from "estree";
import { exportedName, importBindingOf } from "./lib/imports.js";

const SOURCE = "@composurecdk/cloudformation";

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

/**
 * Requires every `stringConstraint({ … })` call to set a non-empty `name`,
 * `allowed` and `source`.
 *
 * Those three fields are what turn a synth-time validation failure into
 * something actionable — they name the offending property, list the characters
 * it accepts, and link the AWS documentation. The factory's type already makes
 * the keys required, so the gap this closes is the one the type checker cannot
 * see: a present-but-empty string compiles happily while degrading every message
 * the constraint will ever produce.
 *
 * Only the `stringConstraint` imported from `@composurecdk/cloudformation` is
 * checked, under any local alias.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/constraint-metadata-required.md | the rule documentation}.
 */
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
        "stringConstraint() is missing required `{{field}}`. Every stringConstraint() must set " +
        "name, allowed and source, so a synth-time error can name the allowed set and link the AWS doc.",
      emptyField:
        "stringConstraint() `{{field}}` is empty. It is surfaced verbatim in the validation " +
        "error message — give it a meaningful value.",
    },
  },
  create(ctx) {
    // Local names bound to the factory, read from the file's imports once, so
    // every other call is skipped before the scope lookup.
    const names = new Set<string>();
    return {
      Program(program: Program) {
        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration" || statement.source.value !== SOURCE) continue;
          for (const specifier of statement.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              exportedName(specifier) === "stringConstraint"
            ) {
              names.add(specifier.local.name);
            }
          }
        }
      },
      CallExpression(node: CallExpression) {
        if (node.callee.type !== "Identifier" || !names.has(node.callee.name)) return;
        // A local declaration can shadow the import.
        const binding = importBindingOf(ctx.sourceCode.getScope(node), node.callee.name);
        if (binding?.source !== SOURCE) return;
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
