import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { ref } from "@composurecdk/core";
import { hostedZoneGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S");
  const hostedZone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, hostedZone, role };
}

// The granted actions land on the role's policy; asserting on the rendered
// template keeps us decoupled from CDK's exact statement and condition shape.
const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

describe("hostedZoneGrants", () => {
  it("delegation delegates to the zone's native grantDelegation", () => {
    const { stack, hostedZone, role } = setup();

    hostedZoneGrants.delegation(hostedZone).applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("route53:ChangeResourceRecordSets");
    expect(json).toContain("route53:ListHostedZonesByName");
    // The native grant conditions the change to NS record sets only, and with
    // no delegatedZoneNames it does not narrow which names they may cover.
    expect(json).toContain("route53:ChangeResourceRecordSetsRecordTypes");
    expect(json).not.toContain("ChangeResourceRecordSetsNormalizedRecordNames");
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("delegation forwards delegatedZoneNames so the grant is scoped to those zones", () => {
    const { stack, hostedZone, role } = setup();

    hostedZoneGrants
      .delegation(hostedZone, { delegatedZoneNames: ["beta.example.com"] })
      .applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("route53:ChangeResourceRecordSetsNormalizedRecordNames");
    expect(json).toContain("beta.example.com");
  });

  it("resolves a Resolvable hosted zone from the build context before granting", () => {
    const { stack, hostedZone, role } = setup();

    hostedZoneGrants
      .delegation(
        ref<{ hostedZone: PublicHostedZone }, PublicHostedZone>("root", (r) => r.hostedZone),
      )
      .applyTo(role, { root: { hostedZone } });

    expect(policyJson(stack)).toContain("route53:ChangeResourceRecordSets");
  });
});
