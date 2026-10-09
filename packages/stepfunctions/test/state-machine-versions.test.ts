import { describe, expect, it } from "vitest";
import { Duration } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { Pass, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { DEFAULT_RETAINED_VERSIONS } from "../src/defaults.js";
import { createStateMachineBuilder } from "../src/state-machine-builder.js";

const passThrough = (scope: Construct) => new Pass(scope, "PassThrough");

const buildAndSynth = buildFixture(
  () => createStateMachineBuilder().definition(passThrough).timeout(Duration.minutes(5)),
  "Workflow",
);

const versioned = buildFixture(
  () =>
    createStateMachineBuilder()
      .definition(passThrough)
      .timeout(Duration.minutes(5))
      .publishVersion(),
  "Workflow",
);

describe("versions", () => {
  it("publishes nothing unless asked", () => {
    const { template, result } = buildAndSynth();

    template.resourceCountIs("AWS::StepFunctions::StateMachineVersion", 0);
    expect(result.version).toBeUndefined();
    expect(result.aliases).toEqual({});
  });

  it("publishes a version tied to the state machine's revision", () => {
    const { template } = versioned((b) => b.publishVersion({ description: "release" }));

    template.hasResourceProperties("AWS::StepFunctions::StateMachineVersion", {
      StateMachineArn: { Ref: Match.stringLikeRegexp("^Workflow") },
      StateMachineRevisionId: {
        "Fn::GetAtt": [Match.stringLikeRegexp("^Workflow"), "StateMachineRevisionId"],
      },
      Description: "release",
    });
  });

  it("keeps a replaced version, so an alias can roll back to it", () => {
    const { template } = versioned();

    // Both policies: CloudFormation's validation (W3011) warns on one alone.
    template.hasResource("AWS::StepFunctions::StateMachineVersion", {
      UpdateReplacePolicy: "Retain",
      DeletionPolicy: "Retain",
    });
  });

  it("prunes to the default retention, re-running for each published version", () => {
    const { template, result } = versioned();

    expect(result.versionPruner).toBeDefined();
    expect(result.versionPrunerLogGroup).toBeDefined();
    template.hasResourceProperties("Custom::StepFunctionsVersionPruner", {
      StateMachineArn: { Ref: Match.stringLikeRegexp("^Workflow") },
      Retain: DEFAULT_RETAINED_VERSIONS,
      VersionArn: { "Fn::GetAtt": ["WorkflowVersion", "Arn"] },
    });
  });

  it("takes a custom retention", () => {
    const { template } = versioned((b) => b.publishVersion({ retain: 12 }));

    template.hasResourceProperties("Custom::StepFunctionsVersionPruner", { Retain: 12 });
  });

  it.each([0, 1001, 2.5])("rejects a retention of %s", (retain) => {
    expect(() => versioned((b) => b.publishVersion({ retain }))).toThrow(
      /retain must be a whole number/,
    );
  });

  it("scopes the pruner's permissions to the state machine and its versions", () => {
    const { template } = versioned();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["states:DeleteStateMachineVersion"]),
            Resource: [
              { Ref: Match.stringLikeRegexp("^Workflow") },
              { "Fn::Join": ["", [{ Ref: Match.stringLikeRegexp("^Workflow") }, ":*"]] },
            ],
          }),
        ]),
      },
    });
  });

  it("supports Express workflows", () => {
    const { template } = versioned((b) => b.stateMachineType(StateMachineType.EXPRESS));

    template.resourceCountIs("AWS::StepFunctions::StateMachineVersion", 1);
  });
});

describe("aliases", () => {
  it("requires a published version", () => {
    expect(() => buildAndSynth((b) => b.addAlias("live"))).toThrow(/call \.publishVersion\(\)/);
  });

  it("rejects a duplicate alias", () => {
    expect(() => createStateMachineBuilder().addAlias("live").addAlias("live")).toThrow(
      /already an alias/,
    );
  });

  it("deploys all at once by default, rolling back on its alarms by name", () => {
    const { template, result } = versioned((b) => b.addAlias("live"));

    expect(Object.keys(result.aliases.live.alarms).sort()).toEqual([
      "executionsFailed",
      "executionsTimedOut",
    ]);
    template.hasResourceProperties("AWS::StepFunctions::StateMachineAlias", {
      Name: "live",
      DeploymentPreference: {
        Type: "ALL_AT_ONCE",
        StateMachineVersionArn: { "Fn::GetAtt": ["WorkflowVersion", "Arn"] },
        Alarms: [
          { Ref: Match.stringLikeRegexp("ExecutionsFailedAlarm") },
          { Ref: Match.stringLikeRegexp("ExecutionsTimedOutAlarm") },
        ],
      },
    });
  });

  it("scopes its alarms to executions through the alias", () => {
    const { template } = versioned((b) => b.addAlias("live"));

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ExecutionsFailed",
      Dimensions: Match.arrayWith([{ Name: "Alias", Value: "live" }]),
    });
  });

  it("shifts traffic gradually with a canary deployment", () => {
    const { template } = versioned((b) =>
      b.addAlias("live", {
        deployment: { type: "CANARY", percentage: 10, interval: Duration.minutes(5) },
      }),
    );

    template.hasResourceProperties("AWS::StepFunctions::StateMachineAlias", {
      DeploymentPreference: Match.objectLike({ Type: "CANARY", Percentage: 10, Interval: 5 }),
    });
  });

  it("rolls back on nothing when its alarms are disabled", () => {
    const { template, result } = versioned((b) => b.addAlias("live", { rollbackAlarms: false }));

    expect(result.aliases.live.alarms).toEqual({});
    template.hasResourceProperties("AWS::StepFunctions::StateMachineAlias", {
      DeploymentPreference: { Type: "ALL_AT_ONCE", StateMachineVersionArn: Match.anyValue() },
    });
  });

  it.each([
    ["an invalid name", "live!", {}, /must be 1–80/],
    ["an all-digit name", "123", {}, /must be 1–80/],
    [
      "a percentage outside 1–99",
      "live",
      { deployment: { type: "LINEAR", percentage: 100, interval: Duration.minutes(1) } },
      /percentage/,
    ],
    [
      "an interval outside 1–2100 minutes",
      "live",
      { deployment: { type: "CANARY", percentage: 10, interval: Duration.seconds(30) } },
      /interval/,
    ],
  ] as const)("rejects %s", (_label, name, options, error) => {
    expect(() => versioned((b) => b.addAlias(name, options))).toThrow(error);
  });

  it("prunes only after every alias has moved", () => {
    const { template } = versioned((b) => b.addAlias("live").addAlias("beta"));

    const [pruner] = Object.values(
      template.findResources("Custom::StepFunctionsVersionPruner"),
    ) as { DependsOn: string[] }[];
    expect(pruner.DependsOn).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^WorkflowAliaslive/),
        expect.stringMatching(/^WorkflowAliasbeta/),
      ]),
    );
  });

  it("preserves the version and aliases across copy()", () => {
    assertCopyPreservesState({
      factory: () =>
        createStateMachineBuilder().definition(passThrough).timeout(Duration.minutes(1)),
      configure: (b) => {
        b.publishVersion().addAlias("live");
      },
      mutate: (b) => {
        b.addAlias("beta");
      },
      build: (b) => b.build(newStack(), "Workflow"),
      inspect: (r) => Object.keys(r.aliases).sort(),
    });
  });
});
