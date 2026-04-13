import type { ManagedPolicyProps } from "aws-cdk-lib/aws-iam";

/**
 * Defaults applied to every customer-managed policy built with
 * {@link createManagedPolicyBuilder}.
 *
 * Customer-managed policies are intentionally light on defaults — the
 * permissive surface of a managed policy is determined entirely by the
 * statements the caller adds, and guardrails against overly permissive
 * statements live in {@link StatementBuilder}.
 */
export const MANAGED_POLICY_DEFAULTS: Partial<ManagedPolicyProps> = {};
