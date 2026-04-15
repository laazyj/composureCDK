import { App } from "aws-cdk-lib";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { compose, ref } from "@composurecdk/core";
import { createStackBuilder, outputs } from "@composurecdk/cloudformation";
import { createCertificateBuilder } from "@composurecdk/acm";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import {
  cloudfrontAliasTarget,
  createAaaaRecordBuilder,
  createARecordBuilder,
  createHostedZoneBuilder,
} from "@composurecdk/route53";

/**
 * A CloudFront distribution exposed at a custom domain name, backed by a
 * Route 53 public hosted zone and an ACM certificate with DNS validation.
 *
 * Demonstrates:
 * - Building a Route 53 hosted zone and an ACM certificate with DNS
 *   validation wired to that zone.
 * - Composing a CloudFront distribution plus apex A/AAAA alias records as a
 *   single system — the records depend on the distribution, enforced by the
 *   dependency graph.
 * - Using the {@link cloudfrontAliasTarget} helper so the record targets are
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

  // Route 53 hosted zone and ACM certificate are built eagerly — the
  // CloudFront distribution builder accepts a concrete `ICertificate`, so we
  // resolve the cert before handing it off.
  const { hostedZone } = createHostedZoneBuilder()
    .zoneName(apexDomain)
    .comment("Primary customer-facing domain")
    .build(stack, "Zone");

  const { certificate } = createCertificateBuilder()
    .domainName(apexDomain)
    .subjectAlternativeNames([wwwDomain])
    .validationZone(hostedZone)
    .build(stack, "Certificate");

  // The distribution and its apex alias records are wired through a composed
  // system so the records are created only after the distribution exists.
  compose(
    {
      cdn: createDistributionBuilder()
        .comment("Custom-domain static website")
        .domainNames([apexDomain, wwwDomain])
        .certificate(certificate)
        .origin(new HttpOrigin("origin.internal.example.net")),

      apexA: createARecordBuilder()
        .zone(hostedZone)
        .target(
          cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
        ),

      apexAaaa: createAaaaRecordBuilder()
        .zone(hostedZone)
        .target(
          cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
        ),
    },
    { cdn: [], apexA: ["cdn"], apexAaaa: ["cdn"] },
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
          value: hostedZone.hostedZoneId,
          description: "Route 53 hosted zone ID (for NS delegation)",
        },
        CertificateArn: {
          value: certificate.certificateArn,
          description: "ACM certificate ARN",
        },
      }),
    )
    .build(stack, "CustomDomainWebsite");

  return { stack };
}
