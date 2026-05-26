import type { Rule, Scope } from "eslint";
import type { Identifier, MemberExpression } from "estree";

/**
 * An `aws-cdk-lib` API that postdates @composurecdk's supported peer-dependency
 * floor, and so must not be used in library `src/`: calling it throws on older
 * (but still supported) CDK versions.
 *
 * Matched by the accessed member name rather than the owning class identifier,
 * so it holds up regardless of how the class is imported or aliased.
 */
interface ForbiddenMember {
  /** True when an accessed property name is the banned member. */
  matches: (propertyName: string) => boolean;
  /** Short description of the banned API for the diagnostic. */
  label: string;
  /** The `aws-cdk-lib` version that introduced it. */
  since: string;
  /** What to use instead. */
  use: string;
}

/**
 * Foundational `isCfn*` guards that predate the floor (core, since v2.0) and
 * are therefore allowed — `isCfnResource` is in fact the portable replacement
 * for the banned per-resource guards.
 */
const ALLOWED_CFN_GUARDS = new Set(["isCfnResource", "isCfnElement"]);

/**
 * The ban list. Add an entry whenever an `aws-cdk-lib` API we reach for turns
 * out to postdate the supported floor — this list is expected to grow as the
 * floor is pinned and lowered ahead of 1.0.0.
 *
 * Seeded with the per-resource `isCfn<Resource>` static type guards, which
 * aws-cdk-lib first shipped on every generated L1 in 2.231.0 (verified by
 * installing real versions: 2.230.0 lacks them, 2.231.0 has them). Calling
 * them (e.g. `CfnAlarm.isCfnAlarm(node)`) throws `TypeError` on the older
 * versions in our `^2` peer range — see issue #146.
 */
/**
 * Loose shape used by `chainRoot` to walk MemberExpression + TS-wrapper nodes
 * uniformly. estree's static types don't model the typescript-eslint-specific
 * wrappers (`TSAsExpression`, `TSNonNullExpression`, `TSSatisfiesExpression`,
 * `TSTypeAssertion`) or `ChainExpression`, so the walk checks `.type` at runtime.
 */
interface WalkNode {
  type: string;
  object?: unknown;
  expression?: unknown;
}

const FORBIDDEN: ForbiddenMember[] = [
  {
    matches: (name) => /^isCfn[A-Z]/.test(name) && !ALLOWED_CFN_GUARDS.has(name),
    label: "the per-resource `Cfn<Resource>.isCfn<Resource>` L1 static type guards",
    since: "2.231.0",
    use:
      "`CfnResource.isCfnResource(x) && x.cfnResourceType === Cfn<Resource>.CFN_RESOURCE_TYPE_NAME` " +
      "(what the static does internally, but valid across the whole peer range), e.g. the " +
      "`isCfnAlarm` helper in @composurecdk/cloudwatch",
  },
];

/**
 * Flags use of `aws-cdk-lib` APIs newer than the supported peer-dependency
 * floor. Such calls compile fine (devDeps track the latest CDK) but throw at
 * runtime for consumers on an older, still-supported CDK version.
 *
 * It fires only when the member chain is rooted at an aws-cdk-lib import —
 * `CfnAlarm.isCfnAlarm`, `cw.CfnAlarm.isCfnAlarm` (named or `* as` submodule),
 * `cdk.aws_cloudwatch.CfnAlarm.isCfnAlarm` — resolved through ESLint's scope
 * manager, so a local that shadows the import name (e.g. a parameter named
 * `CfnAlarm`) is correctly treated as a non-cdk binding. `chainRoot` also
 * unwraps the TS-only wrappers a developer might use to silence types
 * (`as`, `satisfies`, `!`, angle-bracket assertion) so they can't smuggle the
 * call past the rule. A call in the chain (e.g. `Stack.of(x).isCfnY()`) still
 * breaks the root link, since that reads a runtime value, not the import.
 *
 * Known gaps: computed bracket access (`CfnAlarm["isCfnAlarm"](x)`) and
 * `import = require()` are not tracked — both are uncommon in our ESM src.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban aws-cdk-lib APIs newer than the supported peer-dependency floor",
    },
    schema: [],
    messages: {
      aboveFloor:
        "{{label}} were added in aws-cdk-lib {{since}}, above the supported floor — they throw on " +
        "older versions in the peer range. Use {{use}}.",
    },
  },
  create(ctx) {
    // The leftmost identifier a member chain reads from, peeling MemberExpression
    // and the TS-only wrappers typescript-eslint produces (`as`, `!`, `satisfies`,
    // angle-bracket assertion, `?.` ChainExpression). Returns undefined if a call
    // or other expression breaks the chain — `f().isCfnX` reads a runtime value
    // rather than the imported class.
    const TS_WRAPPERS = new Set([
      "ChainExpression",
      "TSAsExpression",
      "TSNonNullExpression",
      "TSSatisfiesExpression",
      "TSTypeAssertion",
    ]);
    const chainRoot = (expr: MemberExpression["object"]): Identifier | undefined => {
      let current = expr as unknown as WalkNode;
      while (current.type === "MemberExpression" || TS_WRAPPERS.has(current.type)) {
        current = (
          current.type === "MemberExpression" ? current.object : current.expression
        ) as WalkNode;
      }
      return current.type === "Identifier" ? (current as unknown as Identifier) : undefined;
    };

    // True when `name` resolves, in the current scope chain, to a binding from
    // an `aws-cdk-lib` ImportDeclaration. This is scope-aware: a local that
    // shadows the import name (e.g. a function parameter named `CfnAlarm`)
    // resolves to its own binding and is NOT treated as the cdk class.
    const rootIsCdkImport = (scope: Scope.Scope, name: string): boolean => {
      for (let current: Scope.Scope | null = scope; current !== null; current = current.upper) {
        const variable = current.set.get(name);
        if (variable === undefined) continue;
        // `.at(0)` (not `[0]`) — defs can be empty at runtime for predefined
        // globals (e.g. `console`), even though `Variable.defs: Definition[]`
        // says otherwise; `.at` gives us the honest `Definition | undefined`.
        const def = variable.defs.at(0);
        if (def?.type !== "ImportBinding") return false;
        // `def.parent` is typed as `ImportDeclaration` but at runtime
        // typescript-eslint also reports `ImportBinding` for `import x =
        // require(...)`, whose parent is a `TSImportEqualsDeclaration` with no
        // `.source`. Widen and check the discriminator before reading `source`.
        const parent = def.parent as { type: string; source?: { value?: unknown } };
        if (parent.type !== "ImportDeclaration") return false;
        const source = parent.source?.value;
        return (
          source === "aws-cdk-lib" ||
          (typeof source === "string" && source.startsWith("aws-cdk-lib/"))
        );
      }
      return false;
    };

    return {
      MemberExpression(node: MemberExpression) {
        if (node.property.type !== "Identifier") return;
        const property = node.property;
        const root = chainRoot(node.object);
        if (root === undefined) return;
        if (!rootIsCdkImport(ctx.sourceCode.getScope(node), root.name)) return;

        const forbidden = FORBIDDEN.find((entry) => entry.matches(property.name));
        if (forbidden === undefined) return;
        ctx.report({
          node: property,
          messageId: "aboveFloor",
          data: { label: forbidden.label, since: forbidden.since, use: forbidden.use },
        });
      },
    };
  },
};
