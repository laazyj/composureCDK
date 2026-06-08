import type { ConstraintNamespace } from "@composurecdk/cloudformation";
import { validateEmail } from "./email.js";

export {
  createBudgetBuilder,
  type IBudgetBuilder,
  type BudgetBuilderProps,
  type BudgetBuilderResult,
  type BudgetLimit,
} from "./budget-builder.js";
export {
  createBudgetAlarmBuilder,
  type IBudgetAlarmBuilder,
  type BudgetAlarmBuilderProps,
  type BudgetAlarmBuilderResult,
} from "./budget-alarm-builder.js";
export { BUDGET_DEFAULTS, DEFAULT_BUDGET_CURRENCIES } from "./defaults.js";
export { type BudgetAlarmConfig, type EstimatedChargesAlarmConfig } from "./alarm-config.js";
export { createBudgetsTopicPolicies } from "./topic-policy.js";
export { email, type Email } from "./email.js";
export {
  resolveSubscribers,
  toCfnNotificationWithSubscribers,
  type NotificationEntry,
  type NotificationType,
  type NotifySubscribers,
  type ResolvedSubscribers,
} from "./notifications.js";

/**
 * This package's AWS-property constraints, grouped by application strategy.
 * The `constraints.validate.*` / `constraints.sanitize.*` shape is identical in
 * every builder package; the underlying constraint definition stays
 * module-private — this namespace is its only public surface. See ADR-0010.
 */
export const constraints = {
  validate: { email: validateEmail },
  sanitize: {},
} satisfies ConstraintNamespace;
