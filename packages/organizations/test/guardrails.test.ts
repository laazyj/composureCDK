import { describe, expect, it } from "vitest";
import { buildFixture } from "@composurecdk/cdk-testing";
import type { StatementBuilder } from "@composurecdk/iam";
import { createServiceControlPolicyBuilder, guardrails, target } from "../src/index.js";

const { GLOBAL_SERVICE_ACTIONS } = guardrails;

const buildAndSynth = buildFixture(
  () =>
    createServiceControlPolicyBuilder()
      .name("Guardrails")
      .attachTo([target.root("r-aaaa")]),
  "Guardrails",
);

/** A statement as CDK renders it into a policy document. */
const statementOf = (statement: StatementBuilder) =>
  statement.build().toStatementJson() as Record<string, unknown>;

describe("guardrails", () => {
  it("denyDisablingSecurityServices covers the quieter CloudTrail calls and both GuardDuty names", () => {
    expect(statementOf(guardrails.denyDisablingSecurityServices())).toEqual({
      Sid: "DenyDisableLogging",
      Effect: "Deny",
      Action: [
        "cloudtrail:StopLogging",
        "cloudtrail:DeleteTrail",
        "cloudtrail:UpdateTrail",
        "cloudtrail:PutEventSelectors",
        "config:StopConfigurationRecorder",
        "config:DeleteConfigurationRecorder",
        "config:DeleteDeliveryChannel",
        "guardduty:DeleteDetector",
        "guardduty:DisassociateFromAdministratorAccount",
        "guardduty:DisassociateFromMasterAccount",
        "guardduty:StopMonitoringMembers",
      ],
      Resource: "*",
    });
  });

  describe("restrictRegions", () => {
    it("denies other regions, exempting the global services", () => {
      expect(statementOf(guardrails.restrictRegions(["eu-west-2"]))).toEqual({
        Sid: "DenyOtherRegions",
        Effect: "Deny",
        NotAction: [...GLOBAL_SERVICE_ACTIONS],
        Resource: "*",
        Condition: { StringNotEquals: { "aws:RequestedRegion": ["eu-west-2"] } },
      });
    });

    it("exempts Budgets, which a budget kill-switch in a region-pinned account calls", () => {
      expect(GLOBAL_SERVICE_ACTIONS).toContain("budgets:*");
    });

    it("takes several regions and extra exempt actions, without duplicates", () => {
      const statement = statementOf(
        guardrails.restrictRegions(["eu-west-2", "us-east-1"], {
          exemptActions: ["s3:ListAllMyBuckets", "iam:*"],
        }),
      );
      expect(statement.Condition).toEqual({
        StringNotEquals: { "aws:RequestedRegion": ["eu-west-2", "us-east-1"] },
      });
      expect(statement.NotAction).toEqual([...GLOBAL_SERVICE_ACTIONS, "s3:ListAllMyBuckets"]);
    });

    it("rejects an empty region list", () => {
      expect(() => guardrails.restrictRegions([])).toThrow(/allowedRegions must name at least one/);
    });
  });

  describe("restrictInstanceTypes", () => {
    it("denies launching types outside the allowlist, wildcards included", () => {
      expect(statementOf(guardrails.restrictInstanceTypes(["t3.micro", "t4g.*"]))).toEqual({
        Sid: "DenyDisallowedInstanceTypes",
        Effect: "Deny",
        Action: "ec2:RunInstances",
        Resource: "arn:aws:ec2:*:*:instance/*",
        Condition: { StringNotLike: { "ec2:InstanceType": ["t3.micro", "t4g.*"] } },
      });
    });

    it("rejects an empty allowlist", () => {
      expect(() => guardrails.restrictInstanceTypes([])).toThrow(/allowedTypes must name/);
    });
  });

  it("returns a fresh builder each call, so extending one leaves the next untouched", () => {
    guardrails.denyLeaveOrganization().sid("Changed");
    expect(statementOf(guardrails.denyLeaveOrganization()).Sid).toBe("DenyLeaveOrg");
  });

  it("lets several guardrails share one policy", () => {
    const { result, stack } = buildAndSynth((b) =>
      b.addStatements([
        guardrails.denyLeaveOrganization(),
        guardrails.denyIamUsers(),
        guardrails.denyDisablingSecurityServices(),
        guardrails.restrictRegions(["eu-west-2"]),
        guardrails.restrictInstanceTypes(["t4g.*"]),
      ]),
    );
    const { Statement } = stack.resolve(result.document) as { Statement: { Sid: string }[] };
    expect(Statement.map((s) => s.Sid)).toEqual([
      "DenyLeaveOrg",
      "DenyIamUserCreation",
      "DenyDisableLogging",
      "DenyOtherRegions",
      "DenyDisallowedInstanceTypes",
    ]);
  });
});
