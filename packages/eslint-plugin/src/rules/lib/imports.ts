import type { Scope } from "eslint";
import type { Identifier, ImportDeclaration, MemberExpression } from "estree";

/**
 * Loose shape used to walk MemberExpression + TS-wrapper nodes uniformly.
 * estree's static types don't model the typescript-eslint-specific wrappers
 * (`TSAsExpression`, `TSNonNullExpression`, `TSSatisfiesExpression`,
 * `TSTypeAssertion`) or `ChainExpression`, so the walk checks `.type` at
 * runtime.
 */
interface WalkNode {
  type: string;
  object?: unknown;
  expression?: unknown;
  callee?: unknown;
}

/**
 * TS-only wrappers a developer might use to silence types. Peeled by
 * {@link unwrapWrappers} and {@link chainRoot} so they cannot smuggle an
 * expression past a rule.
 */
const TS_WRAPPERS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

/** Strip any TS-only wrappers from an expression, returning the node inside. */
export function unwrapWrappers<T>(expr: T): T {
  let current = expr as unknown as WalkNode;
  while (TS_WRAPPERS.has(current.type)) {
    current = current.expression as WalkNode;
  }
  return current as unknown as T;
}

/**
 * The leftmost identifier a member chain reads from — `CfnAlarm` in
 * `cdk.aws_cloudwatch.CfnAlarm`, unwrapping TS wrappers as it goes.
 *
 * Returns `undefined` when a call or other expression breaks the chain:
 * `f().CfnAlarm` reads a runtime value rather than the imported binding, so no
 * rule that reasons about imports should fire on it. `throughCalls` walks into
 * a call's callee instead, for a rule that wants the import an instance was
 * obtained from — `Annotations` in `Annotations.of(scope).addWarningV2`.
 */
export function chainRoot(
  expr: MemberExpression["object"],
  { throughCalls = false }: { throughCalls?: boolean } = {},
): Identifier | undefined {
  let current = unwrapWrappers(expr) as unknown as WalkNode;
  while (
    current.type === "MemberExpression" ||
    (throughCalls && current.type === "CallExpression")
  ) {
    const next = current.type === "CallExpression" ? current.callee : current.object;
    current = unwrapWrappers(next) as WalkNode;
  }
  return current.type === "Identifier" ? (current as unknown as Identifier) : undefined;
}

/** The import a name is bound by: its module specifier and the specifier node. */
export interface ImportBinding {
  source: string;
  specifier: ImportDeclaration["specifiers"][number];
}

/**
 * The import `name` is bound by, or `undefined` when it resolves to anything
 * else — a global, a local declaration, a parameter.
 *
 * Walks outward through the scope chain so a local that shadows an import name
 * wins, matching what the runtime would do.
 */
export function importBindingOf(scope: Scope.Scope, name: string): ImportBinding | undefined {
  for (let current: Scope.Scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable === undefined) continue;
    // `.at(0)` (not `[0]`) — defs can be empty at runtime for predefined
    // globals (e.g. `console`), even though `Variable.defs: Definition[]` says
    // otherwise; `.at` gives us the honest `Definition | undefined`.
    const def = variable.defs.at(0);
    if (def?.type !== "ImportBinding") return undefined;
    // `def.parent` is typed as `ImportDeclaration` but at runtime
    // typescript-eslint also reports `ImportBinding` for `import x =
    // require(...)`, whose parent is a `TSImportEqualsDeclaration` with no
    // `.source`. Widen and check the discriminator before reading `source`.
    const parent = def.parent as { type: string; source?: { value?: unknown } };
    if (parent.type !== "ImportDeclaration") return undefined;
    const source = parent.source?.value;
    return typeof source === "string" ? { source, specifier: def.node } : undefined;
  }
  return undefined;
}

/**
 * The module specifier `name` was imported from, or `undefined` when it
 * resolves to anything else — see {@link importBindingOf}.
 */
export function importSourceOf(scope: Scope.Scope, name: string): string | undefined {
  return importBindingOf(scope, name)?.source;
}

/** True for `aws-cdk-lib` and any submodule of it. */
export function isCdkSource(source: string): boolean {
  return source === "aws-cdk-lib" || source.startsWith("aws-cdk-lib/");
}
