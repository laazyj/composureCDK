import { describe, expect, it } from "vitest";
import { Aws } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AnyPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { buildFixture, newStack, tagsPerResource } from "@composurecdk/cdk-testing";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createStatementBuilder } from "@composurecdk/iam";
import {
  createServiceControlPolicyBuilder,
  type IServiceControlPolicyBuilder,
} from "../src/service-control-policy-builder.js";
import { SERVICE_CONTROL_POLICY_QUOTAS } from "../src/policy-content.js";
import { type PolicyTarget, target } from "../src/target.js";

const ROOT = target.root("r-ab12");
const OU = target.ou("ou-ab12-cdef3456");

const denyLeave = () =>
  createStatementBuilder()
    .sid("DenyLeaveOrg")
    .deny()
    .actions(["organizations:LeaveOrganization"])
    .resources(["*"]);

const buildAndSynth = buildFixture(
  () => createServiceControlPolicyBuilder().name("Guardrails"),
  "Guardrails",
);

/** A minimal valid builder, for tests that vary one thing. */
const valid = (b: IServiceControlPolicyBuilder) => b.addStatements([denyLeave()]).attachTo([ROOT]);

describe("ServiceControlPolicyBuilder", () => {
  it("creates one SCP with the statements as content and the targets as TargetIds", () => {
    const { template, result } = buildAndSynth((b) =>
      valid(b).description("Org baseline").attachTo([OU]),
    );

    template.resourceCountIs("AWS::Organizations::Policy", 1);
    template.hasResourceProperties("AWS::Organizations::Policy", {
      Name: "Guardrails",
      Description: "Org baseline",
      Type: "SERVICE_CONTROL_POLICY",
      TargetIds: ["r-ab12", "ou-ab12-cdef3456"],
      Content: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyLeaveOrg",
            Effect: "Deny",
            Action: ["organizations:LeaveOrganization"],
            Resource: "*",
          },
        ],
      },
    });
    expect(result.policy.cfnResourceType).toBe("AWS::Organizations::Policy");
    expect(result.content.Statement).toHaveLength(1);
  });

  it("writes Content in AWS's example layout: Version first, statement keys in reading order", () => {
    const { result } = buildAndSynth((b) =>
      b
        .addStatements([
          new PolicyStatement({
            sid: "DenyOutsideRegions",
            effect: Effect.DENY,
            notActions: ["iam:*", "sts:*"],
            resources: ["*"],
            conditions: { StringNotEquals: { "aws:RequestedRegion": "eu-west-2" } },
          }),
          createStatementBuilder()
            .allow()
            .actions(["s3:*"])
            .notResources(["arn:aws:s3:::a", "arn:aws:s3:::b"]),
        ])
        .attachTo([ROOT]),
    );

    expect(JSON.stringify(result.content)).toBe(
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyOutsideRegions",
            Effect: "Deny",
            NotAction: ["iam:*", "sts:*"],
            Resource: "*",
            Condition: { StringNotEquals: { "aws:RequestedRegion": "eu-west-2" } },
          },
          { Effect: "Allow", Action: ["s3:*"], NotResource: ["arn:aws:s3:::a", "arn:aws:s3:::b"] },
        ],
      }),
    );
  });

  it("runs the StatementBuilder wildcard guard", () => {
    expect(() =>
      buildAndSynth((b) =>
        b
          .addStatements([createStatementBuilder().allow().actions(["s3:*"]).resources(["*"])])
          .attachTo([ROOT]),
      ),
    ).toThrow(/wildcard resource/);
  });

  describe("exceptPrincipals", () => {
    const breakGlass = "arn:aws:iam::*:role/BreakGlass";

    it("adds an ArnNotLike aws:PrincipalArn condition to Deny statements only", () => {
      const { result } = buildAndSynth((b) =>
        valid(b)
          .addStatements([createStatementBuilder().allow().actions(["ec2:*"]).resources(["arn:x"])])
          .exceptPrincipals([breakGlass]),
      );

      expect(result.content.Statement[0].Condition).toEqual({
        ArnNotLike: { "aws:PrincipalArn": [breakGlass] },
      });
      expect(result.content.Statement[1].Condition).toBeUndefined();
    });

    it("merges with existing conditions without mutating the caller's statement", () => {
      const statement = new PolicyStatement({
        effect: Effect.DENY,
        actions: ["iam:DeleteRole"],
        resources: ["*"],
        conditions: {
          StringEquals: { "aws:RequestedRegion": "eu-west-2" },
          ArnNotLike: { "aws:PrincipalArn": "arn:aws:iam::*:role/Pipeline", "aws:SourceArn": "s" },
        },
      });

      const { result } = buildAndSynth((b) =>
        b
          .addStatements([statement])
          .attachTo([ROOT])
          .exceptPrincipals([breakGlass, "arn:aws:iam::*:role/Pipeline"]),
      );

      expect(result.content.Statement[0].Condition).toEqual({
        StringEquals: { "aws:RequestedRegion": "eu-west-2" },
        ArnNotLike: {
          "aws:PrincipalArn": ["arn:aws:iam::*:role/Pipeline", breakGlass],
          "aws:SourceArn": "s",
        },
      });
      expect(statement.conditions).toEqual({
        StringEquals: { "aws:RequestedRegion": "eu-west-2" },
        ArnNotLike: { "aws:PrincipalArn": "arn:aws:iam::*:role/Pipeline", "aws:SourceArn": "s" },
      });
    });
  });

  describe("validation", () => {
    it("requires a name", () => {
      const stack = newStack();
      expect(() => valid(createServiceControlPolicyBuilder()).build(stack, "P")).toThrow(
        /name\(\.\.\.\) must be set/,
      );
    });

    it("rejects a name over 128 characters and a description over 512", () => {
      expect(() => buildAndSynth((b) => valid(b).name("n".repeat(129)))).toThrow(/128/);
      expect(() => buildAndSynth((b) => valid(b).description("d".repeat(513)))).toThrow(/512/);
    });

    it("rejects a policy with no statements", () => {
      expect(() => buildAndSynth((b) => b.attachTo([ROOT]))).toThrow(/no statements/);
    });

    it("rejects a statement with a Principal", () => {
      expect(() =>
        buildAndSynth((b) =>
          b
            .addStatements([
              createStatementBuilder()
                .sid("WithPrincipal")
                .deny()
                .actions(["s3:*"])
                .resources(["*"])
                .principals([new AnyPrincipal()]),
            ])
            .attachTo([ROOT]),
        ),
      ).toThrow(/"WithPrincipal" has a Principal or NotPrincipal/);
    });

    it("rejects a statement with no action", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.addStatements([createStatementBuilder().deny().resources(["*"])]).attachTo([ROOT]),
        ),
      ).toThrow(/is invalid: .*action/);
    });

    it("throws when there are no targets, unless detached", () => {
      expect(() => buildAndSynth((b) => b.addStatements([denyLeave()]))).toThrow(/no targets/);

      const { template } = buildAndSynth((b) => b.addStatements([denyLeave()]).detached());
      template.hasResourceProperties("AWS::Organizations::Policy", {
        TargetIds: Match.absent(),
      });
    });

    it("rejects detached() together with targets", () => {
      expect(() => buildAndSynth((b) => valid(b).detached())).toThrow(/cannot both be set/);
    });

    it("rejects a malformed target that bypassed target.*", () => {
      expect(() => buildAndSynth((b) => valid(b).attachTo(["ou-nope" as PolicyTarget]))).toThrow(
        /policy target ID "ou-nope" is invalid/,
      );
    });

    it("rejects a document over the SCP size quota", () => {
      const { maxCharacters } = SERVICE_CONTROL_POLICY_QUOTAS;
      const actions = Array.from({ length: maxCharacters / 5 }, (_, i) => `s3:A${String(i)}`);
      expect(() =>
        buildAndSynth((b) =>
          b
            .addStatements([createStatementBuilder().deny().actions(actions).resources(["*"])])
            .attachTo([ROOT]),
        ),
      ).toThrow(new RegExp(`at most ${String(maxCharacters)}`));
    });

    it("accepts a document exactly at the quota", () => {
      const statement = (pad: string) =>
        createStatementBuilder().sid(pad).deny().actions(["s3:*"]).resources(["*"]);
      const base = buildAndSynth((b) => valid(b).addStatements([statement("S")])).result.content;
      // Replace the one-character Sid "S" with padding that brings the document to the quota.
      const pad = "S".repeat(
        SERVICE_CONTROL_POLICY_QUOTAS.maxCharacters - JSON.stringify(base).length + 1,
      );

      const { result } = buildAndSynth((b) => valid(b).addStatements([statement(pad)]));
      expect(JSON.stringify(result.content)).toHaveLength(
        SERVICE_CONTROL_POLICY_QUOTAS.maxCharacters,
      );
    });

    it("skips the size check when the document holds a token", () => {
      const actions = Array.from({ length: 2000 }, (_, i) => `s3:A${String(i)}`);
      expect(() =>
        buildAndSynth((b) =>
          b
            .addStatements([
              createStatementBuilder()
                .deny()
                .actions(actions)
                .resources([`arn:${Aws.PARTITION}:s3:::bucket`]),
            ])
            .attachTo([ROOT]),
        ),
      ).not.toThrow();
    });
  });

  it("resolves targets from a ref", () => {
    const stack = newStack();
    compose(
      {
        ou: { build: () => ({ id: OU }) },
        policy: createServiceControlPolicyBuilder()
          .name("Sandbox")
          .addStatements([denyLeave()])
          .attachTo([ref("ou", (r: { id: PolicyTarget }) => r.id)]),
      },
      { ou: [], policy: ["ou"] },
    ).build(stack, "Org");

    Template.fromStack(stack).hasResourceProperties("AWS::Organizations::Policy", {
      TargetIds: [OU],
    });
  });

  it("applies builder tags to the policy", () => {
    const { template } = buildAndSynth((b) => valid(b).tag("project", "sandbox"));
    expect(Object.values(tagsPerResource(template, "AWS::Organizations::Policy"))[0]).toEqual(
      expect.arrayContaining([{ Key: "project", Value: "sandbox" }]),
    );
  });

  it("copy() preserves statements, exemptions, targets and detachment", () => {
    const build = (b: IServiceControlPolicyBuilder) => b.build(newStack(), "P");
    const inspect = (r: ReturnType<typeof build>) => r.content;

    assertCopyPreservesState({
      factory: () => createServiceControlPolicyBuilder().name("P"),
      configure: (b) => b.addStatements([denyLeave()]).exceptPrincipals(["arn:aws:iam::*:role/A"]),
      mutate: (b) => b.addStatements([denyLeave().sid("Other")]),
      build: (b) => build(b.attachTo([ROOT])),
      inspect,
    });
    assertCopyPreservesState({
      factory: () => createServiceControlPolicyBuilder().name("P").addStatements([denyLeave()]),
      configure: (b) => b.attachTo([ROOT]),
      mutate: (b) => b.attachTo([OU]),
      build,
      inspect: (r) => r.policy.targetIds,
    });
    assertCopyPreservesState({
      factory: () => createServiceControlPolicyBuilder().name("P").addStatements([denyLeave()]),
      configure: (b) => b.detached(),
      mutate: (b) => b.exceptPrincipals(["arn:aws:iam::*:role/A"]),
      build,
      inspect,
    });
  });
});
