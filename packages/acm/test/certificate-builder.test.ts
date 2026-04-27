import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CertificateValidation, KeyAlgorithm } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { ref } from "@composurecdk/core";
import { createCertificateBuilder } from "../src/certificate-builder.js";
import { CERTIFICATE_DEFAULTS } from "../src/defaults.js";

function newStack(): Stack {
  const app = new App();
  return new Stack(app, "TestStack");
}

function buildWithZone(
  configureFn?: (builder: ReturnType<typeof createCertificateBuilder>) => void,
): { template: Template; stack: Stack; zone: PublicHostedZone } {
  const stack = newStack();
  const zone = new PublicHostedZone(stack, "TestZone", { zoneName: "example.com" });
  const builder = createCertificateBuilder()
    .domainName("example.com")
    .validationZone(zone)
    .recommendedAlarms(false);
  configureFn?.(builder);
  builder.build(stack, "TestCertificate");
  return { template: Template.fromStack(stack), stack, zone };
}

describe("CertificateBuilder", () => {
  describe("build", () => {
    it("returns a CertificateBuilderResult with a certificate property", () => {
      const stack = newStack();
      const zone = new PublicHostedZone(stack, "Z", { zoneName: "example.com" });
      const result = createCertificateBuilder()
        .domainName("example.com")
        .validationZone(zone)
        .recommendedAlarms(false)
        .build(stack, "TestCertificate");

      expect(result).toBeDefined();
      expect(result.certificate).toBeDefined();
      expect(result.alarms).toEqual({});
    });

    it("throws when domainName is not set", () => {
      const stack = newStack();
      const zone = new PublicHostedZone(stack, "Z", { zoneName: "example.com" });
      expect(() =>
        createCertificateBuilder().validationZone(zone).build(stack, "TestCertificate"),
      ).toThrow(/requires a domainName/);
    });

    it("throws when no validation is configured", () => {
      const stack = newStack();
      expect(() =>
        createCertificateBuilder().domainName("example.com").build(stack, "TestCertificate"),
      ).toThrow(/requires DNS validation/);
    });

    it("throws when validation, validationZone, and validationZones are combined", () => {
      const stack = newStack();
      const zone = new PublicHostedZone(stack, "Z", { zoneName: "example.com" });
      expect(() =>
        createCertificateBuilder()
          .domainName("example.com")
          .validationZone(zone)
          .validation(CertificateValidation.fromDns(zone))
          .build(stack, "TestCertificate"),
      ).toThrow(/mutually exclusive/);
    });

    it("resolves validationZone when supplied as a Ref via build context", () => {
      const stack = newStack();
      const zone = new PublicHostedZone(stack, "Z", { zoneName: "example.com" });

      createCertificateBuilder()
        .domainName("example.com")
        .validationZone(ref("zone", (r: { hostedZone: PublicHostedZone }) => r.hostedZone))
        .recommendedAlarms(false)
        .build(stack, "TestCertificate", { zone: { hostedZone: zone } });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    });
  });

  describe("synthesised output", () => {
    it("creates exactly one ACM certificate", () => {
      const { template } = buildWithZone();
      template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    });

    it("uses DNS validation wired to the provided hosted zone", () => {
      const { template } = buildWithZone();
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        ValidationMethod: "DNS",
        DomainValidationOptions: Match.arrayWith([
          Match.objectLike({
            DomainName: "example.com",
            HostedZoneId: Match.anyValue(),
          }),
        ]),
      });
    });

    it("applies the RSA_2048 key algorithm default", () => {
      const { template } = buildWithZone();
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        KeyAlgorithm: "RSA_2048",
      });
      expect(CERTIFICATE_DEFAULTS.keyAlgorithm).toBe(KeyAlgorithm.RSA_2048);
    });

    it("includes subject alternative names when provided", () => {
      const { template } = buildWithZone((b) => {
        b.subjectAlternativeNames(["www.example.com", "api.example.com"]);
      });
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        SubjectAlternativeNames: ["www.example.com", "api.example.com"],
      });
    });

    it("supports multi-zone validation", () => {
      const stack = newStack();
      const apex = new PublicHostedZone(stack, "Apex", { zoneName: "example.com" });
      const other = new PublicHostedZone(stack, "Other", { zoneName: "example.net" });

      createCertificateBuilder()
        .domainName("example.com")
        .subjectAlternativeNames(["www.example.net"])
        .validationZones({
          "example.com": apex,
          "www.example.net": other,
        })
        .recommendedAlarms(false)
        .build(stack, "MultiCert");

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        DomainValidationOptions: Match.arrayWith([
          Match.objectLike({ DomainName: "example.com" }),
          Match.objectLike({ DomainName: "www.example.net" }),
        ]),
      });
    });

    it("allows overriding defaults via the fluent API", () => {
      const { template } = buildWithZone((b) => {
        b.keyAlgorithm(KeyAlgorithm.EC_PRIME256V1);
        b.transparencyLoggingEnabled(false);
      });
      template.hasResourceProperties("AWS::CertificateManager::Certificate", {
        KeyAlgorithm: "EC_prime256v1",
        CertificateTransparencyLoggingPreference: "DISABLED",
      });
    });
  });
});
