import { describe, expect, it } from "vitest";
import { App, SecretValue, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import {
  ConfigurationSet,
  EasyDkimSigningKeyLength,
  MailFromBehaviorOnMxFailure,
} from "aws-cdk-lib/aws-ses";
import { ref } from "@composurecdk/core";
import { createEmailIdentityBuilder } from "../src/email-identity-builder.js";

function newStack(): Stack {
  return new Stack(new App(), "TestStack", {
    env: { account: "111111111111", region: "us-east-1" },
  });
}

function newZone(stack: Stack, id = "Zone"): PublicHostedZone {
  return new PublicHostedZone(stack, id, { zoneName: "example.com" });
}

describe("EmailIdentityBuilder", () => {
  it("verifies a domain with Easy DKIM by default", () => {
    const stack = newStack();
    const { emailIdentity, dkim } = createEmailIdentityBuilder()
      .domain("ask.example.com")
      .build(stack, "MailIdentity");

    expect(emailIdentity).toBeDefined();
    expect(dkim).toHaveLength(3);
    expect(dkim[0].name).toBeDefined();
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "ask.example.com",
    });
  });

  it("verifies an email address", () => {
    const stack = newStack();
    createEmailIdentityBuilder().email("info@example.com").build(stack, "MailIdentity");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "info@example.com",
    });
  });

  it("verifies a public hosted zone and auto-publishes DKIM", () => {
    const stack = newStack();
    const { emailIdentity } = createEmailIdentityBuilder()
      .publicHostedZone(newZone(stack))
      .build(stack, "MailIdentity");
    expect(emailIdentity).toBeDefined();
    // CDK auto-publishes 3 DKIM CNAME record sets into the zone.
    Template.fromStack(stack).resourceCountIs("AWS::Route53::RecordSet", 3);
  });

  it("accepts a non-default Easy DKIM signing key length", () => {
    const stack = newStack();
    createEmailIdentityBuilder()
      .domain("example.com")
      .easyDkim(EasyDkimSigningKeyLength.RSA_2048_BIT)
      .build(stack, "MailIdentity");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      DkimSigningAttributes: Match.objectLike({ NextSigningKeyLength: "RSA_2048_BIT" }),
    });
  });

  it("publishes Easy DKIM as three absolute CNAMEs", () => {
    const stack = newStack();
    const { dkimRecords } = createEmailIdentityBuilder()
      .domain("ask.example.com")
      .publishDkim(newZone(stack))
      .build(stack, "MailIdentity");
    expect(dkimRecords).toBeDefined();
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::RecordSet", 3);
    template.hasResourceProperties("AWS::Route53::RecordSet", Match.objectLike({ Type: "CNAME" }));
  });

  it("publishes BYODKIM as a single TXT record", () => {
    const stack = newStack();
    createEmailIdentityBuilder()
      .domain("ask.example.com")
      .byoDkim({
        selector: "sel",
        privateKey: SecretValue.unsafePlainText("private"),
        publicKey: "PUBLICKEY",
      })
      .publishDkim(newZone(stack))
      .build(stack, "MailIdentity");
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Route53::RecordSet", 1);
    template.hasResourceProperties(
      "AWS::Route53::RecordSet",
      Match.objectLike({ Type: "TXT", Name: "sel._domainkey.ask.example.com." }),
    );
  });

  it("defaults MAIL FROM to reject on MX failure", () => {
    const stack = newStack();
    createEmailIdentityBuilder()
      .domain("example.com")
      .mailFromDomain("mail.example.com")
      .build(stack, "MailIdentity");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      MailFromAttributes: Match.objectLike({
        MailFromDomain: "mail.example.com",
        BehaviorOnMxFailure: "REJECT_MESSAGE",
      }),
    });
  });

  it("respects an explicit MAIL FROM behaviour", () => {
    const stack = newStack();
    createEmailIdentityBuilder()
      .domain("example.com")
      .mailFromDomain("mail.example.com")
      .mailFromBehaviorOnMxFailure(MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE)
      .build(stack, "MailIdentity");
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      MailFromAttributes: Match.objectLike({ BehaviorOnMxFailure: "USE_DEFAULT_VALUE" }),
    });
  });

  it("associates a Resolvable configuration set from the build context", () => {
    const stack = newStack();
    const configurationSet = new ConfigurationSet(stack, "MailConfig");
    createEmailIdentityBuilder()
      .domain("example.com")
      .configurationSet(
        ref<{ configurationSet: ConfigurationSet }, ConfigurationSet>(
          "config",
          (r) => r.configurationSet,
        ),
      )
      .build(stack, "MailIdentity", { config: { configurationSet } });
    Template.fromStack(stack).hasResourceProperties("AWS::SES::EmailIdentity", {
      ConfigurationSetAttributes: Match.objectLike({ ConfigurationSetName: Match.anyValue() }),
    });
  });

  it("copies configured state independently", () => {
    const stack = newStack();
    const base = createEmailIdentityBuilder().domain("example.com").publishDkim(newZone(stack));
    const copy = base.copy();
    const { dkimRecords } = copy.build(stack, "MailIdentity");
    expect(dkimRecords).toBeDefined();
  });

  describe("validation", () => {
    it("throws when no identity is set", () => {
      const stack = newStack();
      expect(() => createEmailIdentityBuilder().build(stack, "MailIdentity")).toThrow(
        /set an identity with \.domain\(\), \.email\(\), or \.publicHostedZone\(\)/,
      );
    });

    it("throws when publishing DKIM for an email identity", () => {
      const stack = newStack();
      const builder = createEmailIdentityBuilder()
        .email("info@example.com")
        .publishDkim(newZone(stack));
      expect(() => builder.build(stack, "MailIdentity")).toThrow(/needs a domain identity/);
    });

    it("throws when publishing DKIM over a public hosted zone", () => {
      const stack = newStack();
      const zone = newZone(stack);
      const builder = createEmailIdentityBuilder().publicHostedZone(zone).publishDkim(zone);
      expect(() => builder.build(stack, "MailIdentity")).toThrow(
        /redundant with \.publicHostedZone\(\)/,
      );
    });

    it("throws when publishing BYODKIM without a public key", () => {
      const stack = newStack();
      const builder = createEmailIdentityBuilder()
        .domain("example.com")
        .byoDkim({ selector: "sel", privateKey: SecretValue.unsafePlainText("private") })
        .publishDkim(newZone(stack));
      expect(() => builder.build(stack, "MailIdentity")).toThrow(/needs a publicKey/);
    });
  });
});
