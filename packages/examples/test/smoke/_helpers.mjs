/**
 * Shared helpers for smoke checks. Every helper takes the runner-provided
 * `aws` function as its first argument so checks remain pure ESM modules
 * with no module-level dependency on the runner.
 */

import { setTimeout as delay } from "node:timers/promises";

export const STACK_PREFIX = "ComposureCDK-";

export const HEALTHY_STATUSES = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE"]);

// list-stacks needs an explicit status filter; this is the union of states
// we want to surface — healthy, in-flight, and rolled-back. Dropping the
// in-progress / rollback states would hide stacks that need attention.
export const ACTIVE_FILTERS = [
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_IN_PROGRESS",
  "CREATE_IN_PROGRESS",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE",
];

export function listExampleStacks(aws) {
  const { StackSummaries } = aws(
    "cloudformation",
    "list-stacks",
    "--stack-status-filter",
    ...ACTIVE_FILTERS,
    "--output",
    "json",
  );
  return StackSummaries.filter((s) => s.StackName.startsWith(STACK_PREFIX));
}

export function getStackOutput(aws, stackName, outputKey) {
  const { Stacks } = aws(
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--output",
    "json",
  );
  const output = (Stacks[0]?.Outputs ?? []).find((o) => o.OutputKey === outputKey);
  if (!output) {
    throw new Error(`${stackName} — output ${outputKey} not found`);
  }
  return output.OutputValue;
}

export function findStackResources(aws, stackName, { type, namePattern } = {}) {
  const { StackResourceSummaries } = aws(
    "cloudformation",
    "list-stack-resources",
    "--stack-name",
    stackName,
    "--output",
    "json",
  );
  return StackResourceSummaries.filter((r) => {
    if (type && r.ResourceType !== type) return false;
    if (namePattern && !namePattern.test(r.LogicalResourceId)) return false;
    return true;
  });
}

/**
 * Resolves a Lambda function's CloudWatch log group from its live config.
 * Lambda's default log group is `/aws/lambda/<name>`, but examples may
 * override it via `LoggingConfig` — resolve from the live config rather
 * than guess.
 */
export function resolveLambdaLogGroup(aws, fnName) {
  const cfg = aws(
    "lambda",
    "get-function-configuration",
    "--function-name",
    fnName,
    "--output",
    "json",
  );
  return cfg.LoggingConfig?.LogGroup ?? `/aws/lambda/${fnName}`;
}

export async function pollUntil(predicate, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}
