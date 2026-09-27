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

/** Every REST API in the account/region the checks run against. */
export function listRestApis(aws) {
  const { items } = aws("apigateway", "get-rest-apis", "--output", "json");
  return items ?? [];
}

/**
 * Finds a deployed REST API by the `restApiName` its builder configured.
 * Returns `undefined` when no API of that name exists, so callers can `fail`
 * with their own message.
 */
export function findRestApi(aws, name) {
  return listRestApis(aws).find((api) => api.name === name);
}

/** The invoke URL for a path on a deployed REST API's stage. */
export function restApiUrl(api, region, path, stage = "prod") {
  return `https://${api.id}.execute-api.${region}.amazonaws.com/${stage}${path}`;
}

/**
 * Requests a URL and parses the JSON response, throwing a message that names
 * the status and body on any failure — an API Gateway integration that cannot
 * reach its backend answers 500 with an explanatory body, and that body is the
 * whole diagnosis.
 */
export async function jsonRequest(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} — ${res.status} ${res.statusText}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} ${url} — response was not JSON: ${text}`);
  }
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

/**
 * Polls a log group until it carries an event newer than `sinceMs`, optionally
 * one matching a CloudWatch Logs `filterPattern` (passed as a quoted term, so
 * it matches the pattern anywhere in the message). Resolves `true` on the
 * first match, `false` at `timeoutMs`.
 *
 * Events landing in the function's own log group are how these checks prove
 * both that a Lambda ran and that its execution role could write logs — the
 * invoke API's tailed output proves neither.
 */
export function waitForLogEvents(
  aws,
  { logGroup, sinceMs, filterPattern, timeoutMs = 30_000, intervalMs = 3_000 },
) {
  const patternArgs = filterPattern ? ["--filter-pattern", `"${filterPattern}"`] : [];
  return pollUntil(
    () => {
      const { events } = aws(
        "logs",
        "filter-log-events",
        "--log-group-name",
        logGroup,
        // Reach back a little before the stimulus: the event carries the
        // runtime's timestamp, which can trail the caller's clock.
        "--start-time",
        String(sinceMs - 5_000),
        ...patternArgs,
        "--max-items",
        "1",
        "--output",
        "json",
      );
      return events && events.length > 0;
    },
    { timeoutMs, intervalMs },
  );
}

export async function pollUntil(predicate, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}
