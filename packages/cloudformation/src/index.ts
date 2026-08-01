import type { ConstraintNamespace } from "./constraints/index.js";
import { sanitizeTemplateText, validateTemplateText } from "./constraints/template-text.js";

export {
  createStackBuilder,
  type IStackBuilder,
  type StackBuilderResult,
} from "./stack-builder.js";
export { singleStack, groupedStacks } from "./strategies.js";
export { outputs, type OutputDefinition, type OutputDefinitions } from "./outputs.js";
export { taggedBuilder, type ITaggedBuilder, TAG_OVERRIDE_WARNING_NAME } from "./tagged-builder.js";
export { applyBuilderTags } from "./apply-builder-tags.js";
export { validateTag } from "./tag-validator.js";
export { tags, type TagDefinitions } from "./tags.js";
export {
  type StringConstraint,
  stringConstraint,
  validateString,
  sanitizeString,
  charSets,
  transliterate,
  type ConstraintNamespace,
} from "./constraints/index.js";
export {
  templateTextPolicy,
  type TemplateTextPolicyConfig,
  type TemplateTextViolationMode,
  TEMPLATE_TEXT_WARNING_NAME,
} from "./policies/template-text-policy.js";
export { type TemplateTextFields } from "./policies/template-text-fields.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical
 * in every builder package, so it is discoverable without importing anything
 * beyond the package you already use. See ADR-0010.
 *
 * `templateText` is cross-cutting rather than per-resource — it is the same
 * rule for every free-text field in the template — so it lives here with the
 * mechanism rather than in a service package, as tag validation does.
 * {@link templateTextPolicy} applies it across a whole construct tree; these
 * functions are for validating a single value directly.
 */
export const constraints = {
  validate: { templateText: validateTemplateText },
  sanitize: { templateText: sanitizeTemplateText },
} satisfies ConstraintNamespace;
