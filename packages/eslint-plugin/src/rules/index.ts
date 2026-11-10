import type { Rule } from "eslint";
import { rule as builderMustBeTagged } from "./builder-must-be-tagged.js";
import { rule as builderMustImplementCopyState } from "./builder-must-implement-copy-state.js";
import { rule as constraintMetadataRequired } from "./constraint-metadata-required.js";
import { rule as lifecycleBuildContextRequired } from "./lifecycle-build-context-required.js";
import { rule as lifecycleBuildMustForwardContext } from "./lifecycle-build-must-forward-context.js";
import { rule as noCdkApiAboveFloor } from "./no-cdk-api-above-floor.js";
import { rule as noCjsIncompatibleSyntax } from "./no-cjs-incompatible-syntax.js";
import { rule as noRealmBoundInstanceof } from "./no-realm-bound-instanceof.js";
import { rule as noTypescriptPrivateModifier } from "./no-typescript-private-modifier.js";
import { rule as redeclaredPropMustTrackCdkType } from "./redeclared-prop-must-track-cdk-type.js";

/**
 * Where each rule's documentation lives — the page an editor opens from a
 * reported violation.
 *
 * Pinned to `main` rather than the release tag: reading the package's own
 * version needs a JSON import, which does not emit cleanly to CommonJS
 * (ADR-0007). The cost is that a consumer on an older version is shown current
 * docs, which is the same trade most published plugins make.
 */
const DOCS_BASE =
  "https://github.com/laazyj/composureCDK/blob/main/packages/eslint-plugin/docs/rules";

/**
 * Attaches `meta.docs.url` to every rule, derived from the name it is
 * registered under.
 *
 * Deriving beats writing it per rule: the link an editor offers cannot disagree
 * with the rule id ESLint reports, and adding a rule cannot forget it.
 */
function withDocsUrl<T extends Record<string, Rule.RuleModule>>(entries: T): T {
  return Object.fromEntries(
    Object.entries(entries).map(([name, rule]) => [
      name,
      {
        ...rule,
        meta: { ...rule.meta, docs: { ...rule.meta?.docs, url: `${DOCS_BASE}/${name}.md` } },
      },
    ]),
    // `Object.fromEntries` widens the keys to `string`; the entries are the ones
    // passed in, so the original key types still hold.
  ) as T;
}

export const rules = withDocsUrl({
  "builder-must-be-tagged": builderMustBeTagged,
  "builder-must-implement-copy-state": builderMustImplementCopyState,
  "constraint-metadata-required": constraintMetadataRequired,
  "lifecycle-build-context-required": lifecycleBuildContextRequired,
  "lifecycle-build-must-forward-context": lifecycleBuildMustForwardContext,
  "no-cdk-api-above-floor": noCdkApiAboveFloor,
  "no-cjs-incompatible-syntax": noCjsIncompatibleSyntax,
  "no-realm-bound-instanceof": noRealmBoundInstanceof,
  "no-typescript-private-modifier": noTypescriptPrivateModifier,
  "redeclared-prop-must-track-cdk-type": redeclaredPropMustTrackCdkType,
});
