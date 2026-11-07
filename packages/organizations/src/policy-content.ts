import { Effect, type PolicyStatement } from "aws-cdk-lib/aws-iam";

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

/** One statement of a {@link ServiceControlPolicyContent}, in the shape written to `Content`. */
export interface ServiceControlPolicyStatement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Action?: string[];
  NotAction?: string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: Record<string, Record<string, unknown>>;
}

/** The policy document the builder writes to `AWS::Organizations::Policy` `Content`. */
export interface ServiceControlPolicyContent {
  Version: "2012-10-17";
  Statement: ServiceControlPolicyStatement[];
}

/**
 * Serialises statements into an SCP document.
 *
 * The builder writes the document itself rather than through CDK's
 * `PolicyDocument`, for two reasons. `exceptPrincipals` has to add a
 * condition to statements it does not own, which this does on the JSON
 * without mutating the caller's `PolicyStatement`. And the layout follows
 * AWS's published SCP examples — `Version` first; `Sid`, `Effect`, `Action`,
 * `Resource`, `Condition` in that order; actions always a list; a single
 * resource as a string — where CDK sorts keys and collapses every one-item
 * list. A hand-written SCP that already follows AWS's layout therefore
 * synthesises unchanged when moved onto the builder.
 *
 * @throws If a statement carries a `Principal` or `NotPrincipal`, which SCPs
 * do not support, or names no action.
 */
export function toServiceControlPolicyContent(
  statements: readonly PolicyStatement[],
  exceptPrincipals: readonly string[],
): ServiceControlPolicyContent {
  return {
    Version: "2012-10-17",
    Statement: statements.map((s) => toStatement(s, exceptPrincipals)),
  };
}

function toStatement(
  statement: PolicyStatement,
  exceptPrincipals: readonly string[],
): ServiceControlPolicyStatement {
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

  const isDeny = statement.effect === Effect.DENY;
  const condition = withPrincipalExemption(
    statement.conditions as Record<string, Record<string, unknown>> | undefined,
    isDeny ? exceptPrincipals : [],
  );

  return {
    ...(statement.sid ? { Sid: statement.sid } : {}),
    Effect: isDeny ? "Deny" : "Allow",
    ...nonEmpty("Action", statement.actions),
    ...nonEmpty("NotAction", statement.notActions),
    ...nonEmpty("Resource", collapse(statement.resources)),
    ...nonEmpty("NotResource", collapse(statement.notResources)),
    ...(condition ? { Condition: condition } : {}),
  };
}

/**
 * Adds `ArnNotLike: { aws:PrincipalArn: [...] }` to a statement's
 * conditions, merging into any `aws:PrincipalArn` exemption already there.
 * A negated operator with several values matches when the ARN matches none
 * of them, so the union exempts every listed principal.
 */
function withPrincipalExemption(
  conditions: Record<string, Record<string, unknown>> | undefined,
  principals: readonly string[],
): Record<string, Record<string, unknown>> | undefined {
  const present = conditions && Object.keys(conditions).length > 0 ? conditions : undefined;
  if (principals.length === 0) return present;

  const arnNotLike = present?.ArnNotLike ?? {};
  const existing = arnNotLike["aws:PrincipalArn"];
  const merged = [...new Set([...[existing ?? []].flat(), ...principals])];
  return {
    ...present,
    ArnNotLike: { ...arnNotLike, "aws:PrincipalArn": merged },
  };
}

/** A one-item list as its item, as AWS's examples write a single value. */
export function collapse(values: string[]): string | string[] {
  return values.length === 1 ? values[0] : values;
}

function nonEmpty<K extends string, V extends string | string[]>(
  key: K,
  value: V,
): Partial<Record<K, V>> {
  return value.length > 0 ? ({ [key]: value } as Record<K, V>) : {};
}
