#!/usr/bin/env node
/**
 * Sandbox probe for Step Functions versions and aliases (#600). Not an
 * example: nothing registers it, CI never deploys it, and it is run by hand
 * with `stepfunctions-versions.probe.mjs`, which drives the deploys and
 * reports what AWS actually does. Its findings inform the follow-up phase.
 *
 * Two stacks, one per workflow type, each publishing a version, retaining two,
 * and routing a `live` alias with a five-minute 50% canary, or all at once
 * when the `deployment` context value is `all-at-once`. The `variant` context
 * value picks the workflow:
 *
 * - `good` — succeeds.
 * - `bad` — fails, so executions through the alias fail and the canary's
 *   rollback alarm should fire and roll the alias back.
 * - `bump-N` — succeeds with a different result, publishing a new version
 *   each time N changes, to exercise pruning.
 *
 * The Standard stack also carries the alias-as-target spike: two EventBridge
 * rules start executions on the alias, one wired the way CDK's
 * `SfnStateMachine` target does it (StartExecution granted on the alias ARN),
 * one granted on the state machine's own ARN instead.
 */
import { type App, Duration, Stack } from "aws-cdk-lib";
import { CfnRule, Rule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Fail, Pass, Result, StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import {
  type AliasDeployment,
  createStateMachineBuilder,
  stateMachineGrants,
} from "@composurecdk/stepfunctions";
import { exampleApp } from "../src/app-context.js";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";

/** Event sources the probe runner publishes as, one per target wiring. */
const PROBE_SOURCES = {
  aliasGrant: "composurecdk.probes.sfn.alias-grant",
  baseGrant: "composurecdk.probes.sfn.base-grant",
} as const;

function workflow(variant: string) {
  return (scope: Construct) =>
    variant === "bad"
      ? new Fail(scope, "Broken", { error: "ProbeFailure", cause: "The bad variant always fails." })
      : new Pass(scope, "Done", { result: Result.fromObject({ value: variant }) });
}

function probeStack(
  app: App,
  type: StateMachineType,
  variant: string,
  deployment: AliasDeployment,
) {
  const name = type === StateMachineType.STANDARD ? "Standard" : "Express";
  const stack = new Stack(app, `ComposureCDK-Probe-SfnVersions${name}`);

  const result = createStateMachineBuilder()
    .stateMachineName(`ComposureCDK-Probe-SfnVersions${name}`)
    .stateMachineType(type)
    .timeout(Duration.minutes(5))
    .definition(workflow(variant))
    .publishVersion({ retain: 2 })
    .addAlias("live", { deployment })
    .build(stack, "Workflow");

  return { stack, result };
}

const app = exampleApp();
cleanDeskPolicy(app);
const variant = (app.node.tryGetContext("variant") as string | undefined) ?? "good";
// One minute is shorter than the metrics take to reach the alarms: a 1-minute
// canary completed before its alarms fired. Five matches AWS's own example.
const deployment: AliasDeployment =
  app.node.tryGetContext("deployment") === "all-at-once"
    ? { type: "ALL_AT_ONCE" }
    : { type: "CANARY", percentage: 50, interval: Duration.minutes(5) };

const { stack, result } = probeStack(app, StateMachineType.STANDARD, variant, deployment);
probeStack(app, StateMachineType.EXPRESS, variant, deployment);
const aliasArn = result.aliases.live.alias.attrArn;

// Spike A: CDK's own target, given the alias as an IStateMachine. It grants
// StartExecution on the alias ARN.
new Rule(stack, "AliasGrantRule", {
  eventPattern: { source: [PROBE_SOURCES.aliasGrant] },
  targets: [new SfnStateMachine(StateMachine.fromStateMachineArn(stack, "Alias", aliasArn))],
});

// Spike B: the same target ARN, with StartExecution granted on the state
// machine's own ARN instead.
const role = new Role(stack, "BaseGrantRole", {
  assumedBy: new ServicePrincipal("events.amazonaws.com"),
});
stateMachineGrants.startExecution(result.stateMachine).applyTo(role, {});
new CfnRule(stack, "BaseGrantRule", {
  eventPattern: { source: [PROBE_SOURCES.baseGrant] },
  targets: [{ id: "alias", arn: aliasArn, roleArn: role.roleArn }],
});

app.synth();
