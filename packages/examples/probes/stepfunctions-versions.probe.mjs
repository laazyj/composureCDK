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
 * PROBE_DEPLOYMENT=all-at-once deploys the alias all at once, keeping its
 * rollback alarms, instead of through the canary; every deploy in a run uses it.
 *
 * Steps:
 *   deploy    Deploy both probe stacks with the good variant.
 *   targets   Point 5: start executions through the alias from two EventBridge
 *             rules, one granted on the alias ARN (CDK's SfnStateMachine), one on
 *             the state machine's own ARN. Reports which actually started.
 *   express   Point 6: a synchronous Express execution through the alias.
 *   rollback  Point 3: per stack, with traffic flowing through the alias, deploy
 *             the bad variant behind a 5-minute, 50% canary. Expect the rollback alarm to
 *             fire, CloudFormation to roll back, and the alias to stay on the
 *             good version. Waits out any alarm already in ALARM first, then
 *             reads the alarm history to say whether the canary triggered it.
 *   blocked   With the bad variant live (after rollback) and a rollback alarm held
 *             in ALARM, deploy the good variant. Reports whether CloudFormation
 *             refuses the alias update. Needs PROBE_DEPLOYMENT=all-at-once, the
 *             only mode whose bad deploy stays live.
 *   metrics   Whether the state machine's own ExecutionsFailed, which its
 *             recommended alarm watches, counts executions through the alias.
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
const DEPLOYMENT = process.env.PROBE_DEPLOYMENT ?? "canary";

function deploy(variant, stacks = Object.values(STACKS)) {
  console.log(`  $ cdk deploy -c variant=${variant} -c deployment=${DEPLOYMENT}`);
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
        "-c",
        `deployment=${DEPLOYMENT}`,
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

const routing = (stack) =>
  aws("stepfunctions", "describe-state-machine-alias", "--state-machine-alias-arn", aliasArn(stack))
    .routingConfiguration;

function aliasRouting(stack) {
  return routing(stack)
    .map((r) => `v${r.stateMachineVersionArn.split(":").pop()}=${r.weight}%`)
    .join(", ");
}

/** The alias's rollback alarm names; none unless the alias deploys with them. */
const rollbackAlarms = (stack) =>
  findStackResources(aws, stack, {
    type: "AWS::CloudWatch::Alarm",
    namePattern: /^WorkflowAliaslive/,
  }).map((r) => r.PhysicalResourceId);

/** How long to wait for a rollback alarm to enter, or leave, ALARM. */
const ALARM_WAIT = { timeoutMs: 5 * 60_000, intervalMs: 15_000 };

const stackStatus = (stack) =>
  aws("cloudformation", "describe-stacks", "--stack-name", stack).Stacks[0].StackStatus;

const anyInAlarm = (alarms) =>
  aws("cloudwatch", "describe-alarms", "--alarm-names", ...alarms).MetricAlarms.some(
    (a) => a.StateValue === "ALARM",
  );

/** Whether the alias routes any traffic to the bad variant. */
function liveIsBad(stack) {
  return routing(stack).some(
    (r) =>
      JSON.parse(
        aws(
          "stepfunctions",
          "describe-state-machine",
          "--state-machine-arn",
          r.stateMachineVersionArn,
        ).definition,
      ).States.Broken,
  );
}

/** Starts an execution through the alias every few seconds. Returns `stop()`, which resolves once the loop has ended. */
function startTraffic(stack) {
  let running = true;
  const loop = (async () => {
    while (running) {
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
  return () => {
    running = false;
    return loop;
  };
}

/** Every step but deploy needs the stacks; say so rather than fail mid-step. */
function requireStacks() {
  const { StackSummaries } = aws(
    "cloudformation",
    "list-stacks",
    "--stack-status-filter",
    "CREATE_COMPLETE",
    "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_COMPLETE",
  );
  const live = new Set(StackSummaries.map((s) => s.StackName));
  const missing = Object.values(STACKS).filter((stack) => !live.has(stack));
  if (missing.length) {
    throw new Error(
      `${missing.join(", ")} not deployed in ${process.env.AWS_REGION ?? "the default region"}: run the deploy step first`,
    );
  }
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
      const alarms = rollbackAlarms(stack);
      const short = (name) => name.split("/").pop();

      // An alarm already in ALARM makes CloudFormation abort before shifting any
      // traffic, which tests nothing; a re-run can inherit one from the last run.
      const quiet = await pollUntil(() => !anyInAlarm(alarms), ALARM_WAIT);
      if (!quiet) {
        log(`${type}: SKIPPED — a rollback alarm stayed in ALARM for 5 minutes`);
        continue;
      }
      // Deploying the bad variant over itself shifts no traffic, so tests nothing.
      if (liveIsBad(stack)) {
        log(`${type}: SKIPPED — live already routes to the bad variant; run the deploy step first`);
        continue;
      }

      const before = aliasRouting(stack);
      const stopTraffic = startTraffic(stack);
      const started = new Date();
      const code = await deploy("bad", [stack]);
      await stopTraffic();

      log(
        `${type}: deploy exited ${code} (non-zero expected); stack ${stackStatus(stack)}; live was ${before}, is now ${aliasRouting(stack)}`,
      );
      // Every alarm was out of ALARM before the deploy, so a transition into
      // ALARM since then came from the canary's traffic.
      const history = () =>
        alarms.flatMap((name) =>
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
      const fired = (items) =>
        items.filter((item) => JSON.parse(item.HistoryData).newState.stateValue === "ALARM");
      const finished = new Date();
      let items = history();
      if (code === 0 && !fired(items).length) {
        // The deploy finished first; watch on, to tell an alarm that fired too
        // late to roll back from one that never fired.
        log(`${type}: no alarm fired during the deploy; watching for 5 more minutes`);
        await pollUntil(() => fired((items = history())).length > 0, {
          timeoutMs: 5 * 60_000,
          intervalMs: 30_000,
        });
      }
      const [first] = fired(items).sort((a, b) => a.Timestamp.localeCompare(b.Timestamp));
      const verdict = !first
        ? "NO rollback alarm fired"
        : new Date(first.Timestamp) > finished
          ? `${first.name} fired ${Math.round((new Date(first.Timestamp) - finished) / 1000)}s AFTER the deploy completed — too late to roll back`
          : `canary-triggered rollback (${first.name} fired during the deploy)`;
      log(`${type}: deploy ran ${started.toISOString()} → ${finished.toISOString()}; ${verdict}`);
      for (const item of items)
        log(`${type}:   ${item.Timestamp} ${item.name}: ${item.HistorySummary}`);
    }
  },

  async blocked() {
    // With the bad variant live and its rollback alarm kept in ALARM, deploy
    // the fix: does CloudFormation refuse an all-at-once alias update?
    for (const [type, stack] of Object.entries(STACKS)) {
      const alarms = rollbackAlarms(stack);
      if (!alarms.length) {
        log(`${type}: SKIPPED — no rollback alarms; run with PROBE_DEPLOYMENT=all-at-once`);
        continue;
      }
      if (!liveIsBad(stack)) {
        log(`${type}: SKIPPED — live must route to the bad variant; run the rollback step first`);
        continue;
      }
      const stopTraffic = startTraffic(stack);
      try {
        if (!(await pollUntil(() => anyInAlarm(alarms), ALARM_WAIT))) {
          log(`${type}: SKIPPED — no rollback alarm reached ALARM within 5 minutes`);
          continue;
        }
        const before = aliasRouting(stack);
        const code = await deploy("good", [stack]);
        log(
          `${type}: fix deployed with a rollback alarm in ALARM: ${code === 0 ? "NOT blocked" : "BLOCKED"} (exit ${code}, stack ${stackStatus(stack)}); live was ${before}, is now ${aliasRouting(stack)}`,
        );
      } finally {
        await stopTraffic();
      }
    }
  },

  async metrics() {
    // Do the state machine's own metrics, and so its recommended alarms, count
    // executions started through an alias?
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 3_600_000);
    for (const [type, stack] of Object.entries(STACKS)) {
      const arn = stateMachineArn(stack);
      const failed = (...dimensions) =>
        aws(
          "cloudwatch",
          "get-metric-statistics",
          "--namespace",
          "AWS/States",
          "--metric-name",
          "ExecutionsFailed",
          "--dimensions",
          `Name=StateMachineArn,Value=${arn}`,
          ...dimensions,
          "--start-time",
          start.toISOString(),
          "--end-time",
          end.toISOString(),
          "--period",
          "3600",
          "--statistics",
          "Sum",
        ).Datapoints.reduce((total, d) => total + d.Sum, 0);
      const all = failed();
      const viaAlias = failed("Name=Alias,Value=live");
      const verdict =
        viaAlias === 0
          ? "inconclusive — no failed executions through the alias in 3 hours; run rollback first"
          : all >= viaAlias
            ? "the state machine's metric INCLUDES executions through the alias"
            : "the state machine's metric EXCLUDES executions through the alias";
      log(
        `${type}: ExecutionsFailed over 3h: state machine ${all}, through the alias ${viaAlias}; ${verdict}`,
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
const run = requested.length ? requested : Object.keys(steps);
for (const name of run) {
  if (!steps[name])
    throw new Error(`unknown step "${name}"; one of ${Object.keys(steps).join(", ")}`);
}
if (run[0] !== "deploy" && run[0] !== "destroy") requireStacks();
for (const name of run) {
  console.log(`\n=== ${name} ===`);
  await steps[name]();
}
