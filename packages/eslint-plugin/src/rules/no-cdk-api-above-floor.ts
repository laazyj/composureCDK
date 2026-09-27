import type { Rule, Scope } from "eslint";
import type { ImportDeclaration, ImportSpecifier, MemberExpression, Node } from "estree";
import {
  chainRoot,
  importBindingOf,
  importSourceOf,
  isCdkSource,
  unwrapWrappers,
} from "./lib/imports.js";

/** What every entry in the ban list says about the API it bans. */
interface Banned {
  /** Short description of the banned API for the diagnostic. */
  label: string;
  /** The `aws-cdk-lib` version that introduced it, as `major.minor.patch`. */
  since: string;
  /** What to use instead. */
  use: string;
}

/**
 * A member reached from an `aws-cdk-lib` import.
 *
 * Matched by the accessed member name rather than the owning class identifier,
 * so it holds up regardless of how the class is imported or aliased.
 */
interface BannedMember extends Banned {
  /** True when an accessed property name is the banned member. */
  matches: (propertyName: string) => boolean;
  /**
   * The member lives on an instance a call hands back — `Annotations.of(x)` —
   * so the chain back to the import runs through that call.
   */
  onInstance?: boolean;
}

/** A symbol a module exports, banned wherever it is imported or read from. */
interface BannedExport extends Banned {
  /** The module specifier that exports it, e.g. `aws-cdk-lib/assertions`. */
  module: string;
  /** The exported name. */
  name: string;
}

/**
 * Foundational `isCfn*` guards that predate the floor (core, since v2.0) and
 * are therefore allowed — `isCfnResource` is in fact the portable replacement
 * for the banned per-resource guards.
 */
const ALLOWED_CFN_GUARDS = new Set(["isCfnResource", "isCfnElement"]);

/**
 * The ban list, as members and exports: facts about `aws-cdk-lib`, each true whatever the floor. The
 * rule reports an entry only where the configured floor predates its `since`,
 * so an entry costs nothing in a package whose floor is already above it.
 *
 * Every `since` is the first release carrying the API, verified by installing
 * real versions either side of it.
 */
const BANNED_MEMBERS: readonly BannedMember[] = [
  {
    // First shipped on every generated L1 in 2.231.0; calling one (e.g.
    // `CfnAlarm.isCfnAlarm(node)`) throws `TypeError` below that — issue #146.
    matches: (name) => /^isCfn[A-Z]/.test(name) && !ALLOWED_CFN_GUARDS.has(name),
    label: "the per-resource `Cfn<Resource>.isCfn<Resource>` L1 static type guards",
    since: "2.231.0",
    use:
      "`CfnResource.isCfnResource(x) && x.cfnResourceType === Cfn<Resource>.CFN_RESOURCE_TYPE_NAME` " +
      "(what the static does internally, but valid across the whole peer range), e.g. the " +
      "`isCfnAlarm` helper in @composurecdk/cloudwatch",
  },
  {
    matches: (name) => name === "stringLikeRegexp",
    label: "`Match.stringLikeRegexp`",
    since: "2.9.0",
    use: "an exact value, or a plain regular expression tested against the value read from `Template.toJSON()`",
  },
  {
    matches: (name) => name === "addWarningV2",
    onInstance: true,
    label: "`Annotations.addWarningV2`",
    since: "2.93.0",
    use:
      "`addWarning`, or feature-detect `addWarningV2` and fall back to `addWarning` where it is " +
      "missing, as @composurecdk/cloudformation's template-text policy does",
  },
];

const BANNED_EXPORTS: readonly BannedExport[] = [
  {
    module: "aws-cdk-lib/assertions",
    name: "Annotations",
    label: "`Annotations` from `aws-cdk-lib/assertions`",
    since: "2.10.0",
    use:
      "the construct metadata it reads — `node.metadata` entries of type `aws:cdk:warning` or " +
      "`aws:cdk:error`",
  },
];

/**
 * The `aws-cdk-lib` module an expression names as a namespace, or `undefined`.
 *
 * `cw` in `import * as cw from "aws-cdk-lib/aws-cloudwatch"` names that
 * module; so do the submodule re-exports off the root —
 * `import { assertions } from "aws-cdk-lib"` and `cdk.aws_cloudwatch` — whose
 * underscores are the specifier's hyphens.
 */
function namespaceModule(scope: Scope.Scope, expr: MemberExpression["object"]): string | undefined {
  const node = unwrapWrappers(expr);
  if (node.type === "Identifier") {
    const binding = importBindingOf(scope, node.name);
    if (binding === undefined || !isCdkSource(binding.source)) return undefined;
    const { specifier } = binding;
    if (specifier.type !== "ImportSpecifier") return binding.source;
    return binding.source === "aws-cdk-lib" ? submodule(exportedName(specifier)) : undefined;
  }
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return namespaceModule(scope, node.object) === "aws-cdk-lib"
      ? submodule(node.property.name)
      : undefined;
  }
  return undefined;
}

/** `aws-cdk-lib/aws-cloudwatch` for the root's `aws_cloudwatch` re-export. */
function submodule(name: string): string {
  return `aws-cdk-lib/${name.replaceAll("_", "-")}`;
}

function exportedName({ imported }: ImportSpecifier): string {
  return imported.type === "Identifier" ? imported.name : String(imported.value);
}

/**
 * Flags an `aws-cdk-lib` API newer than the oldest CDK version this package
 * supports.
 *
 * Such a call type-checks and passes tests, because both run against whichever
 * CDK is installed here — the newest. It then throws at runtime for anyone whose
 * own `aws-cdk-lib` is older, while still inside the range the package declares
 * it supports. The fix is a form of the same check that works across the whole
 * range; the rule's message names one per banned API.
 *
 * See {@link https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules/no-cdk-api-above-floor.md | the rule documentation}.
 */
export const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban aws-cdk-lib APIs newer than the supported peer-dependency floor",
    },
    schema: [
      {
        type: "object",
        properties: {
          floor: {
            type: "string",
            pattern: "^\\d+\\.\\d+\\.\\d+$",
            description:
              "The lowest aws-cdk-lib version the linted code supports, as major.minor.patch. " +
              "Only APIs added after it are reported. Unset, every banned API is.",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      aboveFloor:
        "{{label}} arrived in aws-cdk-lib {{since}}, above {{floor}} — it is missing from older " +
        "versions in the peer range, where it throws or fails to compile. Use {{use}}.",
    },
  },
  create(ctx) {
    const { floor } = (ctx.options[0] ?? {}) as { floor?: string };
    const floorText = floor === undefined ? "the supported floor" : `the floor of ${floor}`;
    // `floor` is schema-validated `major.minor.patch`, so numeric collation
    // orders it as a version.
    const applies = (entry: Banned) =>
      floor === undefined || floor.localeCompare(entry.since, "en", { numeric: true }) < 0;
    const members = BANNED_MEMBERS.filter(applies);
    const exports = BANNED_EXPORTS.filter(applies);
    if (members.length === 0 && exports.length === 0) return {};

    const report = (node: Node, entry: Banned) => {
      ctx.report({
        node,
        messageId: "aboveFloor",
        data: { label: entry.label, since: entry.since, floor: floorText, use: entry.use },
      });
    };

    return {
      ImportDeclaration(node: ImportDeclaration) {
        const source = node.source.value;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const name = exportedName(specifier);
          const banned = exports.find((entry) => entry.module === source && entry.name === name);
          if (banned !== undefined) report(specifier, banned);
        }
      },
      MemberExpression(node: MemberExpression) {
        if (node.computed || node.property.type !== "Identifier") return;
        const property = node.property;
        const exported = exports.find((entry) => entry.name === property.name);
        const member = members.find((entry) => entry.matches(property.name));
        if (exported === undefined && member === undefined) return;
        const scope = ctx.sourceCode.getScope(node);

        if (exported !== undefined && namespaceModule(scope, node.object) === exported.module) {
          report(property, exported);
          return;
        }

        if (member === undefined) return;
        const root = chainRoot(node.object, { throughCalls: member.onInstance });
        if (root === undefined) return;
        const source = importSourceOf(scope, root.name);
        if (source !== undefined && isCdkSource(source)) report(property, member);
      },
    };
  },
};
