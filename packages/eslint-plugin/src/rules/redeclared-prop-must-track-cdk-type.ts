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
 * `Resolvable<…>` instead of reading the type from CDK's own prop (ADR-0018).
 *
 * A builder's props interface is `Omit<CdkProps, K>` plus a re-declaration of
 * each lifted key. Everything inside the `Omit` tracks the consumer's installed
 * `aws-cdk-lib`; a re-declared key spelled `Resolvable<IKey>` does not — it
 * freezes at whatever interface was current when it was written. CDK is
 * migrating its prop types to reference interfaces (`IKey` → `IKeyRef`,
 * `IEventBus` → `IEventBusRef`, …) prop by prop, and each time a pinned prop
 * moves the builder silently starts **rejecting values the wrapped construct
 * accepts**. Nothing else catches it: the suites don't typecheck, and `build`
 * runs against the latest CDK where a narrowed prop still compiles.
 *
 * The check is syntactic — a property whose name appears in the `Omit<…>` of
 * the same interface's `extends` clause, whose `Resolvable<…>` argument is a
 * bare type reference imported from `aws-cdk-lib` or `@aws-cdk/*`. No type
 * resolution, so it works in the flat config and fires at authoring time.
 *
 * Not flagged, because each is a deliberate exclusion in ADR-0018:
 * - **Primitives and `any`-shaped types** — `Resolvable<string[]>`,
 *   `Resolvable<Record<string, unknown>>` resolve to no CDK import.
 * - **A widened union** — `Resolvable<string | Foo["bar"]>`, where the arm the
 *   builder adds has no CDK prop to read from. Only a bare reference is flagged.
 * - **A shape-replacing re-declaration** — the builder's own type is the point,
 *   and it is not a `Resolvable` of a CDK interface.
 *
 * Known gap: a prop re-declared in a *separate* interface that the props
 * interface mixes in (`@composurecdk/sqs`'s `QueueBuilderExtensionProps`) has
 * no `Omit` of its own to key on, and a hand-written setter standing in for a
 * lifted prop is a class method rather than a property signature. Both are
 * covered by ADR-0018 and by review, not by this rule.
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
        'from CDK\'s own prop instead: `Resolvable<NonNullable<{{base}}["{{prop}}"]>>` (ADR-0018). ' +
        "Keep the indexed access inline — a named alias reintroduces ADR-0001's TS2883.",
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
