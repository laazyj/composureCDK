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

// --- Summary ----------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("All checks passed");
}
