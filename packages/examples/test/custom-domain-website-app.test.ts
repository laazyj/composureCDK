import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createCustomDomainWebsiteApp } from "../src/custom-domain-website/app.js";

const TEST_DOMAIN = "example.composurecdk.test";

describe("custom-domain-website-app", () => {
  let originalDomain: string | undefined;
  let originalAccount: string | undefined;
  let originalRegion: string | undefined;

  beforeAll(() => {
    originalDomain = process.env.COMPOSURECDK_DOMAIN;
    originalAccount = process.env.CDK_DEFAULT_ACCOUNT;
    originalRegion = process.env.CDK_DEFAULT_REGION;
    process.env.COMPOSURECDK_DOMAIN = TEST_DOMAIN;
    process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
    process.env.CDK_DEFAULT_REGION = "us-east-1";
  });

  afterAll(() => {
    process.env.COMPOSURECDK_DOMAIN = originalDomain;
    process.env.CDK_DEFAULT_ACCOUNT = originalAccount;
    process.env.CDK_DEFAULT_REGION = originalRegion;
  });

  function synthTemplate(): Template {
    const { stack } = createCustomDomainWebsiteApp();
    return Template.fromStack(stack);
  }

  describe("Route 53", () => {
    it("does not create a hosted zone — fromLookup brings in a pre-existing one", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::Route53::HostedZone", 0);
    });

    it("creates apex A and AAAA alias records pointing at the CloudFront distribution", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::Route53::RecordSet", 2);
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "A",
        AliasTarget: Match.objectLike({
          DNSName: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["DomainName"]) }),
        }),
      });
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "AAAA",
        AliasTarget: Match.objectLike({
          DNSName: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["DomainName"]) }),
        }),
      });
    });
  });

  describe("ACM certificate", () => {
    it("creates a single DNS-validated certificate covering apex + www", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        DomainName: TEST_DOMAIN,
        SubjectAlternativeNames: [`www.${TEST_DOMAIN}`],
        ValidationMethod: "DNS",
      });
    });
  });

  describe("CloudFront distribution", () => {
    it("exposes both domain aliases and is wired to the ACM certificate", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: [TEST_DOMAIN, `www.${TEST_DOMAIN}`],
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn: Match.anyValue(),
          }),
        }),
      });
    });
  });

  describe("stack", () => {
    it("has a descriptive stack description", () => {
      const template = synthTemplate();
      expect(template.toJSON().Description).toBe(
        "Static website at a custom domain with Route53 + ACM",
      );
    });

    it("throws when no domain is configured", () => {
      const saved = process.env.COMPOSURECDK_DOMAIN;
      delete process.env.COMPOSURECDK_DOMAIN;
      try {
        expect(() => createCustomDomainWebsiteApp()).toThrow(/requires a domain/);
      } finally {
        process.env.COMPOSURECDK_DOMAIN = saved;
      }
    });
  });
});
