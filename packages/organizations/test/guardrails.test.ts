import { describe, expect, it } from "vitest";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createStatementBuilder, type StatementBuilder } from "@composurecdk/iam";
import { createServiceControlPolicyBuilder } from "../src/service-control-policy-builder.js";
import { guardrails, target } from "../src/index.js";

const { GLOBAL_SERVICE_ACTIONS } = guardrails;

const buildAndSynth = buildFixture(
  () =>
    createServiceControlPolicyBuilder()
      .name("Guardrails")
      .attachTo([target.root("r-aaaa")]),
  "Guardrails",
);

const contentOf = (statement: StatementBuilder) =>
  buildAndSynth((b) => b.addStatements([statement])).result.content;
const statementOf = (statement: StatementBuilder) => contentOf(statement).Statement[0];

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
        Condition: { StringNotEquals: { "aws:RequestedRegion": "eu-west-2" } },
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
        Action: ["ec2:RunInstances"],
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
    const { result } = buildAndSynth((b) =>
      b.addStatements([
        guardrails.denyLeaveOrganization(),
        guardrails.denyIamUsers(),
        guardrails.denyDisablingSecurityServices(),
        guardrails.restrictRegions(["eu-west-2"]),
        guardrails.restrictInstanceTypes(["t4g.*"]),
      ]),
    );
    expect(result.content.Statement.map((s) => s.Sid)).toEqual([
      "DenyLeaveOrg",
      "DenyIamUserCreation",
      "DenyDisableLogging",
      "DenyOtherRegions",
      "DenyDisallowedInstanceTypes",
    ]);
  });
});

/**
 * The acceptance criterion from #25: moving the prototype in
 * laazyj/aws-management-cdk#2 onto the library leaves its template unchanged
 * where the guardrail's content did not deliberately change. Expected text is
 * copied from that repo's snapshot, and compared as JSON text because its
 * snapshot test is order-sensitive.
 */
describe("migrating the aws-management-cdk prototype", () => {
  it.each([
    [
      "RestrictLeavingOrg",
      () => guardrails.denyLeaveOrganization(),
      '{"Version":"2012-10-17","Statement":[{"Sid":"DenyLeaveOrg","Effect":"Deny","Action":["organizations:LeaveOrganization"],"Resource":"*"}]}',
    ],
    [
      "DenyIamUsers",
      () => guardrails.denyIamUsers(),
      '{"Version":"2012-10-17","Statement":[{"Sid":"DenyIamUserCreation","Effect":"Deny","Action":["iam:CreateUser","iam:CreateAccessKey","iam:CreateLoginProfile"],"Resource":"*"}]}',
    ],
    [
      "RestrictEc2PurchaseOptions",
      () =>
        createStatementBuilder()
          .sid("DenyReservedAndSpot")
          .deny()
          .actions([
            "ec2:PurchaseReservedInstancesOffering",
            "ec2:RequestSpotFleet",
            "ec2:RequestSpotInstances",
          ])
          .resources(["*"]),
      '{"Version":"2012-10-17","Statement":[{"Sid":"DenyReservedAndSpot","Effect":"Deny","Action":["ec2:PurchaseReservedInstancesOffering","ec2:RequestSpotFleet","ec2:RequestSpotInstances"],"Resource":"*"}]}',
    ],
  ])("%s synthesises the prototype's Content byte for byte", (_name, statement, expected) => {
    expect(JSON.stringify(contentOf(statement()))).toBe(expected);
  });

  it("RestrictRegions differs only by the Budgets exemption", () => {
    const content = contentOf(guardrails.restrictRegions(["eu-west-2"]));
    content.Statement[0].NotAction = content.Statement[0].NotAction?.filter(
      (a) => a !== "budgets:*",
    );
    expect(JSON.stringify(content)).toBe(
      '{"Version":"2012-10-17","Statement":[{"Sid":"DenyOtherRegions","Effect":"Deny","NotAction":["iam:*","organizations:*","sts:*","signin:*","route53:*","route53domains:*","cloudfront:*","cloudfront-keyvaluestore:*","globalaccelerator:*","networkmanager:*","waf:*","wafv2:*","shield:*","support:*","health:*","trustedadvisor:*","artifact:*","account:*","billing:*","ce:*","cur:*","savingsplans:*","freetier:*","tax:*","payments:*","aws-portal:*","invoicing:*","pricing:*","consolidatedbilling:*","notifications:*","notifications-contacts:*","chatbot:*"],"Resource":"*","Condition":{"StringNotEquals":{"aws:RequestedRegion":"eu-west-2"}}}]}',
    );
  });
});
