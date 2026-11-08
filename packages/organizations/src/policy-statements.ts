import { Stack, Token } from "aws-cdk-lib";
import { Effect, type PolicyDocument, type PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";

/**
 * Quotas AWS Organizations applies to service control policies. Kept in one
 * place so a quota change is a one-line edit.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html
 * @see https://aws.amazon.com/about-aws/whats-new/2026/05/aws-organizations-increased-scp-quotas/
 */
export const SERVICE_CONTROL_POLICY_QUOTAS = {
  /** Maximum characters in an SCP document, as sent (minified) to AWS. Raised from 5,120 in May 2026. */
  maxCharacters: 10_240,
} as const;

/**
 * Checks a statement is valid in an SCP and applies the policy's principal
 * exemption to it. A `Deny` statement that needs the exemption is copied
 * first, so the caller's statement is never changed.
 *
 * @throws If the statement carries a `Principal` or `NotPrincipal`, which
 * SCPs do not support, or is otherwise invalid in any policy.
 */
export function toServiceControlPolicyStatement(
  statement: PolicyStatement,
  exceptPrincipals: readonly string[],
): PolicyStatement {
  const label = statement.sid ? `statement "${statement.sid}"` : "a statement";
  if (statement.principals.length > 0 || statement.notPrincipals.length > 0) {
    throw new Error(
      `Service control policy ${label} has a Principal or NotPrincipal, which SCPs do not support. ` +
        `Scope principals with an aws:PrincipalArn condition instead, or use exceptPrincipals(). ` +
        `See https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html.`,
    );
  }
  const errors = statement.validateForAnyPolicy();
  if (errors.length > 0) {
    throw new Error(`Service control policy ${label} is invalid: ${errors.join("; ")}`);
  }

  if (exceptPrincipals.length === 0 || statement.effect !== Effect.DENY) return statement;

  // A negated operator with several values matches when the ARN matches none
  // of them, so the union exempts every listed principal. The union is
  // computed here because addCondition's merging differs across CDK versions.
  const arnNotLike = (statement.conditions as Record<string, Record<string, unknown>> | undefined)
    ?.ArnNotLike;
  const existing = arnNotLike?.["aws:PrincipalArn"];
  const exempt = statement.copy();
  exempt.addCondition("ArnNotLike", {
    ...arnNotLike,
    "aws:PrincipalArn": [...new Set([...[existing ?? []].flat(), ...exceptPrincipals])],
  });
  return exempt;
}

/**
 * Throws when the document exceeds the SCP size quota, measured as
 * CloudFormation sends it: resolved (so merged, where
 * `@aws-cdk/aws-iam:minimizePolicies` is on) and minified. A document holding
 * a token cannot be measured at synth (ADR-0010 rule 6).
 */
export function assertWithinSizeQuota(
  label: string,
  scope: IConstruct,
  document: PolicyDocument,
): void {
  if (Token.isUnresolved(JSON.stringify(document.toJSON()))) return;
  const length = JSON.stringify(Stack.of(scope).resolve(document)).length;
  const { maxCharacters } = SERVICE_CONTROL_POLICY_QUOTAS;
  if (length > maxCharacters) {
    throw new Error(
      `${label}: the policy document is ${String(length)} characters; service control policies ` +
        `allow at most ${String(maxCharacters)}. Split the statements across more than one policy. ` +
        `See https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html.`,
    );
  }
}
