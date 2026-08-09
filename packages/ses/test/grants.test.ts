import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import { ref } from "@composurecdk/core";
import { identityGrants } from "../src/grants.js";

function setup() {
  const app = new App();
  const stack = new Stack(app, "S", { env: { account: "111111111111", region: "us-east-1" } });
  const identity = new EmailIdentity(stack, "Identity", {
    identity: Identity.domain("example.com"),
  });
  const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
  return { stack, identity, role };
}

const policyJson = (stack: Stack) => JSON.stringify(Template.fromStack(stack).toJSON());

/** Extracts the actions of the IAM statement that grants SES sending. */
function sesSendActions(stack: Stack): string[] {
  const policies = Template.fromStack(stack).findResources("AWS::IAM::Policy") as Record<
    string,
    { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
  >;
  for (const policy of Object.values(policies)) {
    for (const statement of policy.Properties.PolicyDocument.Statement) {
      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      if (actions.includes("ses:SendEmail")) return actions;
    }
  }
  throw new Error("no SES send statement found");
}

describe("identityGrants", () => {
  it("send grants ses:SendEmail and ses:SendRawEmail on the identity", () => {
    const { stack, identity, role } = setup();

    identityGrants.send(identity).applyTo(role, {});

    const json = policyJson(stack);
    expect(json).toContain("ses:SendEmail");
    expect(json).toContain("ses:SendRawEmail");
    Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
  });

  it("resolves a Resolvable identity from the build context before granting", () => {
    const { stack, identity, role } = setup();

    identityGrants
      .send(ref<{ identity: EmailIdentity }, EmailIdentity>("mail", (r) => r.identity))
      .applyTo(role, { mail: { identity } });

    expect(policyJson(stack)).toContain("ses:SendEmail");
  });

  it("sendFrom scopes the grant with a ses:FromAddress condition", () => {
    const { stack, identity, role } = setup();

    identityGrants.sendFrom(identity, ["alerts@example.com"]).applyTo(role, {});

    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ["ses:SendEmail", "ses:SendRawEmail"],
            Condition: { StringLike: { "ses:FromAddress": ["alerts@example.com"] } },
          }),
        ]),
      },
    });
  });

  it("send (native grantSendEmail) and sendFrom grant identical actions", () => {
    // Drift guard: sendFrom hand-rolls the action set (it needs a condition the
    // native grant can't express), so pin it to what grantSendEmail actually
    // grants — if CDK changes grantSendEmail, this fails rather than silently
    // diverging.
    const sendCase = setup();
    identityGrants.send(sendCase.identity).applyTo(sendCase.role, {});

    const sendFromCase = setup();
    identityGrants
      .sendFrom(sendFromCase.identity, ["alerts@example.com"])
      .applyTo(sendFromCase.role, {});

    expect(sesSendActions(sendCase.stack)).toEqual(sesSendActions(sendFromCase.stack));
    expect(sesSendActions(sendCase.stack)).toEqual(["ses:SendEmail", "ses:SendRawEmail"]);
  });
});
