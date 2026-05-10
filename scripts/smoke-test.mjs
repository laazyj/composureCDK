#!/usr/bin/env node

/**
 * Post-deploy smoke test for ComposureCDK example stacks.
 *
 * Verifies that all expected CloudFormation stacks reached CREATE_COMPLETE
 * and that every API Gateway REST API responds to a GET on its root resource.
 *
 * Uses the AWS CLI (preinstalled on GitHub runners) to avoid adding SDK
 * dependencies to the project.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const STACK_PREFIX = "ComposureCDK-";

const HEALTHY_STATUSES = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE"]);

let failures = 0;

function pass(msg) {
  console.log(`  \u2713 ${msg}`);
}

function fail(msg) {
  console.error(`  \u2717 ${msg}`);
  failures++;
}

function aws(...args) {
  const out = execFileSync("aws", args, { encoding: "utf8" });
  return JSON.parse(out);
}

// --- Stack health checks ---------------------------------------------------

console.log("\n=== Stack health ===\n");

// list-stacks returns all stacks (requires ListStacks on *).
// We filter by prefix, then describe each individually
// (DescribeStacks is scoped to ComposureCDK-* in the IAM policy).
const ACTIVE_FILTERS = [
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_IN_PROGRESS",
  "CREATE_IN_PROGRESS",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE",
];
const { StackSummaries: summaries } = aws(
  "cloudformation",
  "list-stacks",
  "--stack-status-filter",
  ...ACTIVE_FILTERS,
  "--output",
  "json",
);

const exampleNames = summaries
  .filter((s) => s.StackName.startsWith(STACK_PREFIX))
  .map((s) => s.StackName);

if (exampleNames.length === 0) {
  fail(`No stacks found with prefix ${STACK_PREFIX}`);
} else {
  for (const name of exampleNames) {
    const { Stacks: stacks } = aws(
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      name,
      "--output",
      "json",
    );
    const stack = stacks[0];
    if (HEALTHY_STATUSES.has(stack.StackStatus)) {
      pass(`${stack.StackName} — ${stack.StackStatus}`);
    } else {
      fail(`${stack.StackName} — ${stack.StackStatus}`);
    }
  }
}

// --- API Gateway endpoint checks -------------------------------------------

console.log("\n=== API endpoint checks ===\n");

const { items: apis } = aws("apigateway", "get-rest-apis", "--output", "json");

function getRegion() {
  if (process.env.AWS_REGION) return process.env.AWS_REGION;
  if (process.env.AWS_DEFAULT_REGION) return process.env.AWS_DEFAULT_REGION;
  return execFileSync("aws", ["configure", "get", "region"], { encoding: "utf8" }).trim();
}

const region = getRegion();

const exampleApiPaths = {
  MockApi: "/",
  MultiStackApi: "/",
  PetStore: "/pets",
};

const exampleApis = (apis ?? []).filter((api) => api.name in exampleApiPaths);

if (exampleApis.length === 0) {
  fail("No example REST APIs found");
} else {
  for (const api of exampleApis) {
    const path = exampleApiPaths[api.name];
    const url = `https://${api.id}.execute-api.${region}.amazonaws.com/prod${path}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        pass(`${api.name} (${url}) — ${res.status}`);
      } else {
        fail(`${api.name} (${url}) — ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      fail(`${api.name} (${url}) — ${err.message}`);
    }
  }
}

// --- Static website checks ---------------------------------------------------

console.log("\n=== Static website checks ===\n");

const WEBSITE_STACK = "ComposureCDK-StaticWebsiteStack";

try {
  const { Stacks: wsStacks } = aws(
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    WEBSITE_STACK,
    "--output",
    "json",
  );
  const outputs = wsStacks[0]?.Outputs ?? [];
  const urlOutput = outputs.find((o) => o.OutputKey === "DistributionUrl");

  if (!urlOutput) {
    fail(`${WEBSITE_STACK} — DistributionUrl output not found`);
  } else {
    const siteUrl = urlOutput.OutputValue;

    // Check index page serves HTML
    const indexRes = await fetch(siteUrl);
    const indexBody = await indexRes.text();
    if (indexRes.ok && indexBody.includes("</html>")) {
      pass(`${siteUrl} — ${indexRes.status} (index page)`);
    } else {
      fail(`${siteUrl} — ${indexRes.status} (expected HTML index page)`);
    }

    // Check 404 returns custom error page
    const errorRes = await fetch(`${siteUrl}/does-not-exist`);
    const errorBody = await errorRes.text();
    if (errorRes.status === 404 && errorBody.includes("</html>")) {
      pass(`${siteUrl}/does-not-exist — ${errorRes.status} (custom error page)`);
    } else {
      fail(`${siteUrl}/does-not-exist — ${errorRes.status} (expected 404 with custom error page)`);
    }
  }
} catch (err) {
  fail(`${WEBSITE_STACK} — ${err.message}`);
}

// --- Lambda invoke checks ---------------------------------------------------

console.log("\n=== Lambda invoke checks ===\n");

const DUAL_FUNCTION_STACK = "ComposureCDK-DualFunctionStack";

try {
  const { StackResourceSummaries: dfResources } = aws(
    "cloudformation",
    "list-stack-resources",
    "--stack-name",
    DUAL_FUNCTION_STACK,
    "--output",
    "json",
  );
  const apiFn = dfResources.find(
    (r) => r.ResourceType === "AWS::Lambda::Function" && /api/i.test(r.LogicalResourceId),
  );

  if (!apiFn) {
    fail(`${DUAL_FUNCTION_STACK} — api Lambda not found`);
  } else {
    const fnName = apiFn.PhysicalResourceId;
    const cfg = aws(
      "lambda",
      "get-function-configuration",
      "--function-name",
      fnName,
      "--output",
      "json",
    );
    // Lambda's default log group is /aws/lambda/<name>; this stack overrides
    // it via LoggingConfig so resolve from the live config rather than guess.
    const logGroup = cfg.LoggingConfig?.LogGroup ?? `/aws/lambda/${fnName}`;

    const outputFile = join(tmpdir(), `composurecdk-smoke-invoke-${process.pid}.json`);
    const invokeStartMs = Date.now();
    let responsePayload;
    let invokeMeta;
    try {
      invokeMeta = aws(
        "lambda",
        "invoke",
        "--function-name",
        fnName,
        "--payload",
        "{}",
        "--cli-binary-format",
        "raw-in-base64-out",
        "--output",
        "json",
        outputFile,
      );
      responsePayload = JSON.parse(readFileSync(outputFile, "utf8"));
    } finally {
      rmSync(outputFile, { force: true });
    }

    const okInvoke =
      invokeMeta.StatusCode === 200 &&
      !invokeMeta.FunctionError &&
      responsePayload.statusCode === 200;

    if (okInvoke) {
      pass(`${fnName} — invoked, response.statusCode=200`);
    } else {
      fail(
        `${fnName} — invoke StatusCode=${invokeMeta.StatusCode}, FunctionError=${invokeMeta.FunctionError ?? "none"}, payload=${JSON.stringify(responsePayload)}`,
      );
    }

    // Poll the log group for events emitted by this invocation. The invoke
    // API's --log-type Tail returns runtime-captured stdout, which doesn't
    // prove the execution role's CloudWatch Logs permissions — only events
    // landing in the log group do.
    const filterArgs = [
      "logs",
      "filter-log-events",
      "--log-group-name",
      logGroup,
      "--start-time",
      String(invokeStartMs - 5_000),
      "--max-items",
      "1",
      "--output",
      "json",
    ];
    let logsSeen = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { events } = aws(...filterArgs);
      if (events && events.length > 0) {
        logsSeen = true;
        break;
      }
      await delay(2_000);
    }

    if (logsSeen) {
      pass(`${logGroup} — execution role wrote logs`);
    } else {
      fail(`${logGroup} — no log events after 30s`);
    }
  }
} catch (err) {
  fail(`${DUAL_FUNCTION_STACK} — ${err.message}`);
}

// --- EC2 instance checks ----------------------------------------------------

console.log("\n=== EC2 instance checks ===\n");

const EC2_STACK = "ComposureCDK-Ec2Stack";

try {
  const { StackResourceSummaries: resources } = aws(
    "cloudformation",
    "list-stack-resources",
    "--stack-name",
    EC2_STACK,
    "--output",
    "json",
  );
  const instanceIds = resources
    .filter((r) => r.ResourceType === "AWS::EC2::Instance")
    .map((r) => r.PhysicalResourceId);

  if (instanceIds.length === 0) {
    fail(`${EC2_STACK} — no AWS::EC2::Instance resources found`);
  } else {
    // describe-instance-status only returns "running" instances by default.
    // --include-all-instances surfaces stopped/pending so we can report state
    // explicitly rather than getting an empty result.
    const { InstanceStatuses: statuses } = aws(
      "ec2",
      "describe-instance-status",
      "--instance-ids",
      ...instanceIds,
      "--include-all-instances",
      "--output",
      "json",
    );

    for (const id of instanceIds) {
      const status = statuses.find((s) => s.InstanceId === id);
      if (!status) {
        fail(`${id} — no status returned`);
        continue;
      }
      const state = status.InstanceState?.Name;
      const sys = status.SystemStatus?.Status;
      const inst = status.InstanceStatus?.Status;
      if (state === "running" && sys === "ok" && inst === "ok") {
        pass(`${id} — running, system=ok, instance=ok`);
      } else {
        fail(`${id} — state=${state}, system=${sys}, instance=${inst}`);
      }
    }
  }
} catch (err) {
  fail(`${EC2_STACK} — ${err.message}`);
}

// --- Summary ----------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("All checks passed");
}
