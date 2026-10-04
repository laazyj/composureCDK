#!/usr/bin/env node
/**
 * Runs the Step Functions versions and aliases probe (#600) against a sandbox
 * account and reports what AWS actually does. Run by hand from
 * packages/examples, with sandbox credentials and AWS_REGION set:
 *
 *   npx nx build examples
 *   node probes/stepfunctions-versions.probe.mjs            # every step, in order
 *   node probes/stepfunctions-versions.probe.mjs targets    # one or more named steps
 *
 * Steps:
 *   deploy    Deploy both probe stacks with the good variant.
 *   targets   Point 5: start executions through the alias from two EventBridge
 *             rules, one granted on the alias ARN (CDK's SfnStateMachine), one on
 *             the state machine's own ARN. Reports which actually started.
 *   express   Point 6: a synchronous Express execution through the alias.
 *   rollback  Point 3: with traffic flowing through each alias, deploy the bad
 *             variant behind a 50% canary. Expect the rollback alarm to fire,
 *             CloudFormation to roll back, and the alias to stay on the good version.
 *   prune     Point 2: publish three more versions (retain 2) and list what survives.
 *   destroy   Tear both stacks down.
 */
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { findStackResources, pollUntil } from "../test/smoke/_helpers.mjs";

const STACKS = {
  standard: "ComposureCDK-Probe-SfnVersionsStandard",
  express: "ComposureCDK-Probe-SfnVersionsExpress",
};
// Must match PROBE_SOURCES in stepfunctions-versions.ts.
const SOURCES = {
  aliasGrant: "composurecdk.probes.sfn.alias-grant",
  baseGrant: "composurecdk.probes.sfn.base-grant",
};
const APP = "node dist/probes/stepfunctions-versions.js";

// The same shape scripts/smoke-test.mjs passes to the smoke helpers.
const aws = (...args) => JSON.parse(execFileSync("aws", args, { encoding: "utf8" }) || "{}");
const log = (msg) => console.log(`  ${msg}`);

/** `cdk deploy` the variant; resolves to its exit code rather than throwing. */
function deploy(variant, stacks = Object.values(STACKS)) {
  console.log(`  $ cdk deploy -c variant=${variant}`);
  return new Promise((done) => {
    const child = spawn(
      "npx",
      [
        "cdk",
        "deploy",
        "--app",
        APP,
        "-c",
        `variant=${variant}`,
        "--require-approval",
        "never",
        ...stacks,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("exit", (code) => done(code ?? 1));
  });
}

/** Cached: no probe deploy replaces the state machine. */
const arns = new Map();
function stateMachineArn(stack) {
  if (!arns.has(stack)) {
    const [resource] = findStackResources(aws, stack, { type: "AWS::StepFunctions::StateMachine" });
    arns.set(stack, resource.PhysicalResourceId);
  }
  return arns.get(stack);
}

const aliasArn = (stack) => `${stateMachineArn(stack)}:live`;

function versions(stack) {
  const { stateMachineVersions } = aws(
    "stepfunctions",
    "list-state-machine-versions",
    "--state-machine-arn",
    stateMachineArn(stack),
  );
  return stateMachineVersions
    .map((v) => v.stateMachineVersionArn.split(":").pop())
    .sort((a, b) => a - b);
}

function aliasRouting(stack) {
  const { routingConfiguration } = aws(
    "stepfunctions",
    "describe-state-machine-alias",
    "--state-machine-alias-arn",
    aliasArn(stack),
  );
  return routingConfiguration
    .map((r) => `v${r.stateMachineVersionArn.split(":").pop()}=${r.weight}%`)
    .join(", ");
}

const steps = {
  async deploy() {
    if ((await deploy("good")) !== 0) throw new Error("deploying the good variant failed");
    for (const [type, stack] of Object.entries(STACKS)) {
      log(`${type}: versions [${versions(stack).join(", ")}], live → ${aliasRouting(stack)}`);
    }
  },

  async targets() {
    const run = `probe-${Date.now()}`;
    const since = Date.now() - 5_000;
    const entries = Object.entries(SOURCES).map(([wiring, Source]) => ({
      Source,
      DetailType: "Probe",
      Detail: JSON.stringify({ run, wiring }),
    }));
    const { FailedEntryCount } = aws(
      "events",
      "put-events",
      "--entries",
      JSON.stringify(entries),
      "--output",
      "json",
    );
    log(`published one event per wiring (failed entries: ${FailedEntryCount})`);

    // Describe each new execution once, and stop as soon as both wirings show up.
    const started = new Map();
    const described = new Set();
    await pollUntil(
      () => {
        const { executions } = aws(
          "stepfunctions",
          "list-executions",
          "--state-machine-arn",
          stateMachineArn(STACKS.standard),
          "--max-items",
          "20",
          "--output",
          "json",
        );
        for (const e of executions) {
          if (described.has(e.executionArn) || new Date(e.startDate).getTime() < since) continue;
          described.add(e.executionArn);
          const { input } = aws(
            "stepfunctions",
            "describe-execution",
            "--execution-arn",
            e.executionArn,
            "--output",
            "json",
          );
          const wiring = Object.keys(SOURCES).find((w) => input.includes(run) && input.includes(w));
          if (wiring) started.set(wiring, e);
        }
        return started.size === Object.keys(SOURCES).length;
      },
      { timeoutMs: 60_000, intervalMs: 5_000 },
    );
    for (const wiring of Object.keys(SOURCES)) {
      const e = started.get(wiring);
      log(
        `${wiring}: ${e ? `started, through ${e.stateMachineAliasArn ?? "no alias"}` : "NOTHING STARTED within 60s — check the rule's FailedInvocations metric"}`,
      );
    }
  },

  async express() {
    try {
      const result = aws(
        "stepfunctions",
        "start-sync-execution",
        "--state-machine-arn",
        aliasArn(STACKS.express),
        "--input",
        "{}",
      );
      log(`start-sync-execution through the alias: ${result.status}, output ${result.output}`);
    } catch (error) {
      log(
        `start-sync-execution through the alias FAILED: ${String(error.stderr ?? error.message).trim()}`,
      );
    }
    log(
      `express versions [${versions(STACKS.express).join(", ")}], live → ${aliasRouting(STACKS.express)}`,
    );
  },

  async rollback() {
    const before = Object.fromEntries(Object.entries(STACKS).map(([t, s]) => [t, aliasRouting(s)]));
    let traffic = true;
    const generator = (async () => {
      while (traffic) {
        for (const stack of Object.values(STACKS)) {
          aws(
            "stepfunctions",
            "start-execution",
            "--state-machine-arn",
            aliasArn(stack),
            "--input",
            "{}",
          );
        }
        await delay(3_000);
      }
    })();
    const code = await deploy("bad");
    traffic = false;
    await generator;
    log(
      `deploying the bad variant exited ${code} (non-zero expected: the canary should roll back)`,
    );
    for (const [type, stack] of Object.entries(STACKS)) {
      const { Stacks } = aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack,
        "--output",
        "json",
      );
      log(
        `${type}: stack ${Stacks[0].StackStatus}; live was ${before[type]}, is now ${aliasRouting(stack)}`,
      );
    }
  },

  async prune() {
    for (const n of [1, 2, 3]) {
      if ((await deploy(`bump-${n}`)) !== 0) throw new Error(`deploying bump-${n} failed`);
    }
    for (const [type, stack] of Object.entries(STACKS)) {
      log(
        `${type}: versions [${versions(stack).join(", ")}] (expect 2, plus any the alias routes to), live → ${aliasRouting(stack)}`,
      );
    }
  },

  async destroy() {
    execFileSync("npx", ["cdk", "destroy", "--app", APP, "--force", ...Object.values(STACKS)], {
      stdio: "inherit",
    });
  },
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(steps)) {
  if (!steps[name])
    throw new Error(`unknown step "${name}"; one of ${Object.keys(steps).join(", ")}`);
  console.log(`\n=== ${name} ===`);
  await steps[name]();
}
