import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createCustomDomainWebsiteApp } from "../src/custom-domain-website/app.js";

function synthTemplate(): Template {
  const { stack } = createCustomDomainWebsiteApp();
  return Template.fromStack(stack);
}

describe("custom-domain-website-app", () => {
  describe("Route 53 hosted zone", () => {
    it("creates exactly one public hosted zone for the apex", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::Route53::HostedZone", 1);
      template.hasResourceProperties("AWS::Route53::HostedZone", {
        Name: "example.composurecdk.com.",
      });
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
        DomainName: "example.composurecdk.com",
        SubjectAlternativeNames: ["www.example.composurecdk.com"],
        ValidationMethod: "DNS",
      });
    });
  });

  describe("CloudFront distribution", () => {
    it("exposes both domain aliases and is wired to the ACM certificate", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: ["example.composurecdk.com", "www.example.composurecdk.com"],
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
  });
});
