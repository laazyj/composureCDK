import type { Rule } from "eslint";
import type { MethodDefinition, Node, PropertyDefinition } from "estree";

/**
 * Loose shapes for the typescript-eslint nodes estree does not model. Each
 * selector guarantees the type, so the rule reads only the field it needs.
 */
interface ParameterPropertyLike {
  parameter: Node;
}

interface AccessorPropertyLike {
  key: Node;
  computed: boolean;
}

/**
 * The member's own name, for the message. A computed key has no name to give —
 * `#[expr]` is not a thing — so the message falls back to a placeholder rather
 * than naming whatever expression produced the key.
 */
function memberName(key: Node, computed: boolean): string {
  if (computed) return "field";
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return "field";
}

/** The bound name of a parameter, seeing through a default value. */
function parameterName(parameter: Node): string {
  const bound = parameter.type === "AssignmentPattern" ? parameter.left : parameter;
  return bound.type === "Identifier" ? bound.name : "field";
}

/**
 * Bans the TypeScript `private` modifier in favour of ECMAScript private fields.
 *
 * The two are not interchangeable once a class is generic over its own members.
 * A TypeScript `private` member is still part of the type, so it appears in
 * `keyof T`, survives into a mapped type, and reaches the emitted `.d.ts` — where
 * a consumer's compiler cannot name it and reports TS4094. A `#field` is not
 * part of the type at all, so it never gets that far.
 *
 * A private constructor stays allowed: `#constructor` is not valid syntax, so
 * there is nothing to prefer over it.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/no-typescript-private-modifier.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban the TypeScript `private` modifier in favour of ECMAScript `#` fields",
    },
    schema: [],
    messages: {
      property:
        "Use an ECMAScript private field (`#{{name}}`) instead of the TypeScript `private` " +
        "modifier. A `private` member still appears in `keyof T` and is carried through mapped " +
        "types into the emitted .d.ts, where it produces TS4094 for consumers.",
      method:
        "Use an ECMAScript private method (`#{{name}}()`) instead of the TypeScript `private` " +
        "modifier. A private constructor is the only permitted use, since `#constructor` is not " +
        "valid syntax.",
      parameterProperty:
        "A parameter property cannot be ECMAScript private. Declare the field as " +
        "`readonly #{{name}}` and assign it in the constructor body.",
    },
  },
  create(ctx) {
    // Each handler reports on the member's own name rather than the whole
    // declaration: the fix replaces the modifier and renames the key, so a
    // narrow squiggle points at both.
    return {
      "PropertyDefinition[accessibility='private']"(node: PropertyDefinition) {
        ctx.report({
          node: node.key,
          messageId: "property",
          data: { name: memberName(node.key, node.computed) },
        });
      },
      "MethodDefinition[accessibility='private'][kind!='constructor']"(node: MethodDefinition) {
        ctx.report({
          node: node.key,
          messageId: "method",
          data: { name: memberName(node.key, node.computed) },
        });
      },
      // `accessor x` is a distinct node from a plain field, and its `private`
      // reaches `keyof T` the same way.
      "AccessorProperty[accessibility='private']"(node: Node) {
        const { key, computed } = node as unknown as AccessorPropertyLike;
        ctx.report({ node: key, messageId: "property", data: { name: memberName(key, computed) } });
      },
      "TSParameterProperty[accessibility='private']"(node: Node) {
        const { parameter } = node as unknown as ParameterPropertyLike;
        ctx.report({
          node: parameter,
          messageId: "parameterProperty",
          data: { name: parameterName(parameter) },
        });
      },
    };
  },
};
