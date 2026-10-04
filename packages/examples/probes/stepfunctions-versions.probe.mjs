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
 *   rollback  Point 3: per stack, with traffic flowing through the alias, deploy
 *             the bad variant behind a 50% canary. Expect the rollback alarm to
 *             fire, CloudFormation to roll back, and the alias to stay on the
 *             good version. Waits out any alarm already in ALARM first, then
 *             reads the alarm history to say whether the canary triggered it.
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

// The same shape scripts/smoke-test.mjs passes to the smoke helpers. The
// environment forces JSON, so the result never depends on the caller's profile.
const aws = (...args) =>
  JSON.parse(
    execFileSync("aws", args, {
      encoding: "utf8",
      env: { ...process.env, AWS_DEFAULT_OUTPUT: "json" },
    }) || "{}",
  );
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
    const { FailedEntryCount } = aws("events", "put-events", "--entries", JSON.stringify(entries));
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
        );
        for (const e of executions) {
          if (described.has(e.executionArn) || new Date(e.startDate).getTime() < since) continue;
          described.add(e.executionArn);
          const { input } = aws(
            "stepfunctions",
            "describe-execution",
            "--execution-arn",
            e.executionArn,
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
    // One stack at a time, Standard first: a single `cdk deploy` of both stops
    // at the first failure, which is the outcome this step expects.
    for (const [type, stack] of Object.entries(STACKS)) {
      const alarms = findStackResources(aws, stack, {
        type: "AWS::CloudWatch::Alarm",
        namePattern: /^WorkflowAliaslive/,
      }).map((r) => r.PhysicalResourceId);
      const short = (name) => name.split("/").pop();

      // An alarm already in ALARM makes CloudFormation abort before shifting any
      // traffic, which tests nothing; a re-run can inherit one from the last run.
      const quiet = await pollUntil(
        () =>
          aws("cloudwatch", "describe-alarms", "--alarm-names", ...alarms).MetricAlarms.every(
            (a) => a.StateValue !== "ALARM",
          ),
        { timeoutMs: 5 * 60_000, intervalMs: 15_000 },
      );
      if (!quiet) {
        log(`${type}: SKIPPED — a rollback alarm stayed in ALARM for 5 minutes`);
        continue;
      }

      const before = aliasRouting(stack);
      let traffic = true;
      const generator = (async () => {
        while (traffic) {
          aws(
            "stepfunctions",
            "start-execution",
            "--state-machine-arn",
            aliasArn(stack),
            "--input",
            "{}",
          );
          await delay(3_000);
        }
      })();
      const started = new Date();
      const code = await deploy("bad", [stack]);
      traffic = false;
      await generator;

      const { Stacks } = aws("cloudformation", "describe-stacks", "--stack-name", stack);
      log(
        `${type}: deploy exited ${code} (non-zero expected); stack ${Stacks[0].StackStatus}; live was ${before}, is now ${aliasRouting(stack)}`,
      );
      // Every alarm was out of ALARM before the deploy, so a transition into
      // ALARM since then means the canary's traffic tripped it.
      const history = alarms.flatMap((name) =>
        aws(
          "cloudwatch",
          "describe-alarm-history",
          "--alarm-name",
          name,
          "--history-item-type",
          "StateUpdate",
          "--start-date",
          started.toISOString(),
        ).AlarmHistoryItems.map((item) => ({ ...item, name: short(name) })),
      );
      const fired = history.filter(
        (item) => JSON.parse(item.HistoryData).newState.stateValue === "ALARM",
      );
      log(
        `${type}: ${fired.length ? `canary-triggered rollback (${fired.map((i) => i.name).join(", ")} fired)` : "NO rollback alarm fired after the deploy started"}`,
      );
      for (const item of history)
        log(`${type}:   ${item.Timestamp} ${item.name}: ${item.HistorySummary}`);
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
