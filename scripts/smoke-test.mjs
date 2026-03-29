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

const { Stacks: allStacks } = aws("cloudformation", "describe-stacks", "--output", "json");

const exampleStacks = allStacks.filter((s) => s.StackName.startsWith(STACK_PREFIX));

if (exampleStacks.length === 0) {
  fail(`No stacks found with prefix ${STACK_PREFIX}`);
} else {
  for (const stack of exampleStacks) {
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

const exampleApiNames = new Set(["LambdaApi", "MockApi", "MultiStackApi", "StrategyApi"]);

const exampleApis = (apis ?? []).filter((api) => exampleApiNames.has(api.name));

if (exampleApis.length === 0) {
  fail("No example REST APIs found");
} else {
  for (const api of exampleApis) {
    const url = `https://${api.id}.execute-api.${region}.amazonaws.com/prod/`;
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

// --- Summary ----------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("All checks passed");
}
