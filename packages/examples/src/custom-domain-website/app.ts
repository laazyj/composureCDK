import { App } from "aws-cdk-lib";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { compose, ref } from "@composurecdk/core";
import { createStackBuilder, outputs } from "@composurecdk/cloudformation";
import { createCertificateBuilder, type CertificateBuilderResult } from "@composurecdk/acm";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import {
  cloudfrontAliasTarget,
  createAaaaRecordBuilder,
  createARecordBuilder,
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";

/**
 * A CloudFront distribution exposed at a custom domain name, backed by a
 * Route 53 public hosted zone and an ACM certificate with DNS validation.
 *
 * Demonstrates:
 * - A single {@link compose} graph wiring a Route 53 hosted zone, an ACM
 *   DNS-validated certificate, a CloudFront distribution, and apex A/AAAA
 *   alias records — with every cross-component link declared as a {@link ref}.
 * - The {@link cloudfrontAliasTarget} helper so the record targets are
 *   produced at build time from the composed distribution.
 *
 * Note: CloudFront viewer certificates must live in `us-east-1`. This example
 * places the whole stack in the default environment — in production, you'd
 * either deploy the stack to `us-east-1` or split the certificate into a
 * dedicated `us-east-1` stack and wire it across via cross-region references.
 */
export function createCustomDomainWebsiteApp(app = new App()) {
  const { stack } = createStackBuilder()
    .description("Static website at a custom domain with Route53 + ACM")
    .build(app, "ComposureCDK-CustomDomainWebsiteStack");

  const apexDomain = "example.com";
  const wwwDomain = `www.${apexDomain}`;

  compose(
    {
      zone: createHostedZoneBuilder()
        .zoneName(apexDomain)
        .comment("Primary customer-facing domain"),

      certificate: createCertificateBuilder()
        .domainName(apexDomain)
        .subjectAlternativeNames([wwwDomain])
        .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone)),

      cdn: createDistributionBuilder()
        .comment("Custom-domain static website")
        .domainNames([apexDomain, wwwDomain])
        .certificate(ref("certificate", (r: CertificateBuilderResult) => r.certificate))
        .origin(new HttpOrigin("origin.internal.example.net")),

      apexA: createARecordBuilder()
        .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
        .target(
          cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
        ),

      apexAaaa: createAaaaRecordBuilder()
        .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
        .target(
          cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
        ),
    },
    {
      zone: [],
      certificate: ["zone"],
      cdn: ["certificate"],
      apexA: ["zone", "cdn"],
      apexAaaa: ["zone", "cdn"],
    },
  )
    .afterBuild(
      outputs({
        DomainUrl: {
          value: `https://${apexDomain}`,
          description: "Customer-facing URL",
        },
        DistributionDomainName: {
          value: ref(
            "cdn",
            (r: DistributionBuilderResult) => r.distribution.distributionDomainName,
          ),
          description: "CloudFront-assigned domain name (alias target)",
        },
        HostedZoneId: {
          value: ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone.hostedZoneId),
          description: "Route 53 hosted zone ID (for NS delegation)",
        },
        CertificateArn: {
          value: ref("certificate", (r: CertificateBuilderResult) => r.certificate.certificateArn),
          description: "ACM certificate ARN",
        },
      }),
    )
    .build(stack, "CustomDomainWebsite");

  return { stack };
}
