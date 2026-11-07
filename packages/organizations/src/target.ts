import { Token } from "aws-cdk-lib";
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

const ROOT_ID: StringConstraint = {
  name: "Organizations root ID",
  pattern: /^r-[0-9a-z]{4,32}$/,
  allowed: '"r-" followed by 4 to 32 lowercase letters or digits',
  source: POLICY_SOURCE,
};

const ORGANIZATIONAL_UNIT_ID: StringConstraint = {
  name: "Organizations organizational unit ID",
  pattern: /^ou-[0-9a-z]{4,32}-[a-z0-9]{8,32}$/,
  allowed:
    '"ou-", 4 to 32 lowercase letters or digits (the root\'s ID suffix), "-", then 8 to 32 lowercase letters or digits',
  source: POLICY_SOURCE,
};

const ACCOUNT_ID: StringConstraint = {
  name: "AWS account ID",
  pattern: /^\d{12}$/,
  allowed: "exactly 12 digits",
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
  if (Token.isUnresolved(value)) return;
  if ([ROOT_ID, ORGANIZATIONAL_UNIT_ID, ACCOUNT_ID].some((c) => c.pattern.test(value))) return;
  throw new Error(
    `Organizations policy target ID "${value}" is invalid. Allowed: a root ID ("r-…"), ` +
      `an organizational unit ID ("ou-…-…") or a 12-digit account ID. See ${POLICY_SOURCE}.`,
  );
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
