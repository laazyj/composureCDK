import { type StringConstraint, validateString } from "@composurecdk/cloudformation";
import { POLICY_SOURCE } from "./policy-constraints.js";

declare const policyTargetBrand: unique symbol;

/**
 * A validated AWS Organizations policy target: the ID of the organization
 * root, an organizational unit, or a member account. Construct one with
 * {@link target}; the brand stops a bare string reaching `TargetIds` without
 * having been checked. A value holding an unresolved CDK token is branded
 * unchecked (ADR-0010 rule 6).
 */
export type PolicyTarget = string & { readonly [policyTargetBrand]: true };

// Each ID is a format (a prefix, then a run), not a character class, so these
// are written as patterns rather than with stringConstraint(). The bodies are
// written once and anchored here, so the any-target pattern below cannot
// drift from them.
const ROOT_BODY = "r-[0-9a-z]{4,32}";
const OU_BODY = "ou-[0-9a-z]{4,32}-[a-z0-9]{8,32}";
const ACCOUNT_BODY = "\\d{12}";

const ROOT_ID: StringConstraint = {
  name: "Organizations root ID",
  pattern: new RegExp(`^${ROOT_BODY}$`),
  allowed: '"r-" followed by 4 to 32 lowercase letters or digits',
  source: POLICY_SOURCE,
};

const ORGANIZATIONAL_UNIT_ID: StringConstraint = {
  name: "Organizations organizational unit ID",
  pattern: new RegExp(`^${OU_BODY}$`),
  allowed:
    '"ou-", 4 to 32 lowercase letters or digits (the root\'s ID suffix), "-", then 8 to 32 lowercase letters or digits',
  source: POLICY_SOURCE,
};

const ACCOUNT_ID: StringConstraint = {
  name: "AWS account ID",
  pattern: new RegExp(`^${ACCOUNT_BODY}$`),
  allowed: "exactly 12 digits",
  source: POLICY_SOURCE,
};

const POLICY_TARGET_ID: StringConstraint = {
  name: "Organizations policy target ID",
  pattern: new RegExp(`^(?:${ROOT_BODY}|${OU_BODY}|${ACCOUNT_BODY})$`),
  allowed: 'a root ID ("r-…"), an organizational unit ID ("ou-…-…") or a 12-digit account ID',
  source: POLICY_SOURCE,
};

/** Validates an Organizations root ID (`r-…`). @throws on invalid input. */
export function validateRootId(value: string): void {
  validateString(value, ROOT_ID);
}

/** Validates an organizational unit ID (`ou-…-…`). @throws on invalid input. */
export function validateOrganizationalUnitId(value: string): void {
  validateString(value, ORGANIZATIONAL_UNIT_ID);
}

/** Validates a 12-digit AWS account ID. @throws on invalid input. */
export function validateAccountId(value: string): void {
  validateString(value, ACCOUNT_ID);
}

/**
 * Validates a value as any of the three target kinds. The builder runs this
 * over every resolved target, so a `PolicyTarget` produced by a cast rather
 * than by {@link target} is still checked before it reaches CloudFormation.
 *
 * @throws If the value is not a root, OU or account ID.
 */
export function validatePolicyTargetId(value: string): void {
  validateString(value, POLICY_TARGET_ID);
}

/**
 * Validated constructors for {@link PolicyTarget}. Each throws at the call
 * site when the ID is malformed, naming the expected format.
 *
 * @example
 * ```ts
 * createServiceControlPolicyBuilder()
 *   .attachTo([target.ou("ou-ab12-cdef3456"), target.account("123456789012")]);
 * ```
 */
export const target = {
  /**
   * The organization root, e.g. `r-ab12`. Attaching to the root applies the
   * policy to every member account — but never to the management account.
   */
  root: branded(validateRootId),
  /** An organizational unit, e.g. `ou-ab12-cdef3456`. */
  ou: branded(validateOrganizationalUnitId),
  /** A member account, by its 12-digit ID. */
  account: branded(validateAccountId),
};

function branded(validate: (id: string) => void): (id: string) => PolicyTarget {
  return (id) => {
    validate(id);
    return id as PolicyTarget;
  };
}
