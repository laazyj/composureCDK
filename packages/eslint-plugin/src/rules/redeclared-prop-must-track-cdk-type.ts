import type { Rule } from "eslint";
import type { Node } from "estree";
import { isCdkSource } from "./lib/imports.js";

/**
 * Loose shapes for the typescript-eslint type nodes this rule walks. estree's
 * static types don't model them, so the walk checks `.type` at runtime — and
 * reads `typeArguments` with a `typeParameters` fallback, the two spellings
 * typescript-eslint has used for a type-reference's arguments.
 */
interface TypeNode {
  type: string;
  [key: string]: unknown;
}

interface TypeReferenceLike extends TypeNode {
  typeName: TypeNode;
}

/** True for `@aws-cdk/aws-*-alpha` and friends, alongside `aws-cdk-lib`. */
function isCdkModule(source: string): boolean {
  return isCdkSource(source) || source.startsWith("@aws-cdk/");
}

/** The first type argument of a type reference or interface heritage, either spelling. */
function typeArgAt(node: TypeNode, index: number): TypeNode | undefined {
  const args = (node.typeArguments ?? node.typeParameters) as TypeNode | undefined;
  const params = (args?.params as TypeNode[] | undefined) ?? [];
  return params.at(index);
}

/** The leftmost identifier of `Foo` or `ns.Foo`, or `undefined` for anything else. */
function rootName(typeName: TypeNode): string | undefined {
  let current = typeName;
  while (current.type === "TSQualifiedName") current = current.left as TypeNode;
  return current.type === "Identifier" ? (current.name as string) : undefined;
}

/** The string keys named by `Omit`'s second argument, ignoring non-literal ones. */
function literalKeys(node: TypeNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.type === "TSUnionType") {
    return (node.types as TypeNode[]).flatMap((t) => literalKeys(t));
  }
  if (node.type !== "TSLiteralType") return [];
  const literal = node.literal as { value?: unknown };
  return typeof literal.value === "string" ? [literal.value] : [];
}

/** The keys an interface's `extends` clause omits from a base CDK props type. */
function omittedKeys(heritage: TypeNode[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of heritage) {
    const expression = entry.expression as TypeNode | undefined;
    if (expression?.type !== "Identifier" || expression.name !== "Omit") continue;
    for (const key of literalKeys(typeArgAt(entry, 1))) keys.add(key);
  }
  return keys;
}

/** Every `Resolvable<…>` reference nested anywhere inside a type annotation. */
function resolvableRefs(node: unknown, found: TypeReferenceLike[] = []): TypeReferenceLike[] {
  if (node === null || typeof node !== "object" || !("type" in node)) return found;
  const typed = node as TypeNode;
  if (typed.type === "TSTypeReference" && rootName(typed.typeName as TypeNode) === "Resolvable") {
    found.push(typed as TypeReferenceLike);
  }
  for (const [key, value] of Object.entries(typed)) {
    // `parent` points back up the tree — following it never terminates.
    if (key === "parent") continue;
    if (Array.isArray(value)) for (const item of value) resolvableRefs(item, found);
    else resolvableRefs(value, found);
  }
  return found;
}

/** The property name of a `key: T` signature, or `undefined` for a computed one. */
function propertyName(member: TypeNode): string | undefined {
  if (member.type !== "TSPropertySignature" || member.computed === true) return undefined;
  const key = member.key as TypeNode;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/**
 * Flags a re-declared CDK prop that pins a named CDK interface inside
 * `Resolvable<…>` rather than reading the type from CDK's own prop.
 *
 * A builder's props type is CDK's props type with a few keys lifted out and
 * re-declared. Everything left inside the `Omit` keeps tracking whichever
 * `aws-cdk-lib` the consumer installed; a key re-spelled with a named interface
 * stops tracking it, freezing at whatever that interface meant when it was
 * written. When CDK later widens that prop, the builder goes on rejecting values
 * the construct it wraps now accepts — and it surfaces in the consumer's own
 * compile, not in this package's.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/redeclared-prop-must-track-cdk-type.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A re-declared CDK prop must read its type from CDK's own prop, not pin an interface",
    },
    schema: [],
    messages: {
      pinnedType:
        "`{{prop}}` re-declares a prop omitted from `{{base}}`, but pins `{{pinned}}` — the " +
        "builder stops accepting what CDK accepts as soon as CDK widens the prop. Read the type " +
        'from CDK\'s own prop instead: `Resolvable<NonNullable<{{base}}["{{prop}}"]>>`. ' +
        "Keep the indexed access inline — extracting it to a named alias puts an unnameable " +
        "type into the emitted declaration.",
    },
  },
  create(ctx) {
    const cdkTypeNames = new Set<string>();
    const listener: Rule.RuleListener = {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !isCdkModule(node.source.value)) return;
        for (const spec of node.specifiers) {
          cdkTypeNames.add(spec.local.name);
        }
      },
    };

    listener.TSInterfaceDeclaration = (node: Node) => {
      const decl = node as unknown as TypeNode;
      const heritage = (decl.extends as TypeNode[] | undefined) ?? [];
      const omitted = omittedKeys(heritage);
      if (omitted.size === 0) return;

      // Name the base the indexed access should read from — the first `Omit`'s
      // own base, which is the CDK props type in every builder that has one.
      const omit = heritage.find(
        (entry) => (entry.expression as TypeNode | undefined)?.name === "Omit",
      );
      const omitBase = omit === undefined ? undefined : typeArgAt(omit, 0);
      const base =
        (omitBase === undefined ? undefined : rootName(omitBase.typeName as TypeNode)) ??
        "CdkProps";

      const body = ((decl.body as TypeNode | undefined)?.body as TypeNode[] | undefined) ?? [];
      for (const member of body) {
        const prop = propertyName(member);
        if (prop === undefined || !omitted.has(prop)) continue;

        for (const resolvable of resolvableRefs(member.typeAnnotation)) {
          const inner = typeArgAt(resolvable, 0);
          if (inner?.type !== "TSTypeReference") continue;
          const pinned = rootName(inner.typeName as TypeNode);
          if (pinned === undefined || !cdkTypeNames.has(pinned)) continue;

          ctx.report({
            node: inner as unknown as Node,
            messageId: "pinnedType",
            data: { prop, base, pinned },
          });
        }
      }
    };
    return listener;
  },
};
