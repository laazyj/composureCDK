import type { RuleProps } from "aws-cdk-lib/aws-events";

/**
 * Defaults applied to every EventBridge rule built with
 * {@link createRuleBuilder}.
 *
 * Intentionally empty: the L2 {@link RuleProps} defaults already align with
 * AWS recommendations (`enabled: true`, default account event bus). No
 * additional secure default exists at this layer — DLQs are caller-owned and
 * configured per target, not on the rule itself.
 */
export const RULE_DEFAULTS: Partial<RuleProps> = {};
