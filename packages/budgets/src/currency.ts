import { Annotations, Token } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
import { DEFAULT_BUDGET_CURRENCIES } from "./defaults.js";

/**
 * Throws if `unit` is not in {@link DEFAULT_BUDGET_CURRENCIES}.
 *
 * `context` is woven into the message (e.g. `BudgetBuilder "X": limit
 * unit ...`) so callers can blame the right field. Catches typos like
 * `"USDD"` or `"ZZZ"` at synth instead of mid-deploy.
 */
export function assertValidBudgetCurrency(unit: string, context: string): void {
  if (DEFAULT_BUDGET_CURRENCIES.includes(unit)) return;
  throw new Error(
    `${context}: "${unit}" is not a recognised AWS Budgets currency code. ` +
      `Expected one of: ${DEFAULT_BUDGET_CURRENCIES.join(", ")}.`,
  );
}

/**
 * Annotates `scope` with a non-fatal warning when `unit` is anything
 * other than `USD`. The synth context cannot see an account's billing
 * currency, and AWS Budgets rejects `BudgetLimit.Unit` values that
 * don't match it — so a non-USD configuration deserves a "make sure
 * this matches your billing currency" nudge.
 *
 * Short-circuits on unresolved tokens so env-agnostic stacks aren't
 * spammed.
 */
export function warnIfNonUsdCurrency(scope: IConstruct, unit: string, context: string): void {
  if (Token.isUnresolved(unit)) return;
  if (unit === "USD") return;
  Annotations.of(scope).addWarningV2(
    "@composurecdk/budgets:limit-currency",
    `${context}: currency "${unit}" must match the account's billing currency or AWS Budgets ` +
      `will reject the request at deploy time. Most accounts default to USD; verify yours and ` +
      `suppress this warning if intentional.`,
  );
}
