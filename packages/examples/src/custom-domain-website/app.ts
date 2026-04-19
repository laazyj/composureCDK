import { App } from "aws-cdk-lib";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { HostedZone } from "aws-cdk-lib/aws-route53";
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
} from "@composurecdk/route53";

/**
 * A CloudFront distribution exposed at a custom domain name, backed by a
 * pre-existing Route 53 public hosted zone and an ACM certificate with DNS
 * validation.
 *
 * ## Prerequisites (one-time, per AWS account)
 *
 * 1. **Pre-existing hosted zone.** Create a public hosted zone in Route 53
 *    for a domain you control (e.g. `example.yourcompany.com`). This example
 *    looks the zone up at synth time via {@link HostedZone.fromLookup} — it
 *    does not create the zone. ACM's DNS validation challenge can only be
 *    answered by a zone whose nameservers are already published on the
 *    public internet, which is an out-of-band step that can't reliably be
 *    automated inside the same stack.
 * 2. **NS delegation.** At your domain registrar (or in the parent zone),
 *    delegate the sub-domain to the four nameservers Route 53 assigned to
 *    the hosted zone. Until the delegation is live on the public internet,
 *    `cdk deploy` will stall indefinitely on ACM validation.
 * 3. **`COMPOSURECDK_DOMAIN` env var** (or `--context domain=...`). The
 *    example reads the apex domain from context first, env var second. Tests
 *    set the env var; the CI workflow passes it via `cdk deploy --context`.
 * 4. **Account + region.** `HostedZone.fromLookup` cannot run in an
 *    environment-agnostic stack, so `CDK_DEFAULT_ACCOUNT` and
 *    `CDK_DEFAULT_REGION` must resolve (the CDK CLI sets these from your
 *    AWS credentials).
 *
 * See `docs/ci.md` for the one-time CI setup (IAM permissions, GitHub
 * Environment variable, hosted-zone provisioning).
 *
 * ## What this shows
 *
 * - Bringing an external, pre-existing Route 53 hosted zone into a
 *   composition via `HostedZone.fromLookup` and passing it directly into
 *   the certificate + record builders.
 * - Declaring the DNS-validated certificate, CloudFront distribution, and
 *   apex A/AAAA alias records inside a single {@link compose} call, with
 *   dependencies as data.
 * - Using the {@link cloudfrontAliasTarget} helper so record targets are
 *   produced at build time from the composed distribution.
 *
 * CloudFront viewer certificates must live in `us-east-1`. This example
 * places the whole stack in the caller's default region — in production,
 * either deploy the stack to `us-east-1` or split the certificate into a
 * dedicated `us-east-1` stack and wire it across via cross-region
 * references.
 */
export function createCustomDomainWebsiteApp(app = new App()) {
  const domainContext: unknown = app.node.tryGetContext("domain");
  const apexDomain: string | undefined =
    typeof domainContext === "string" ? domainContext : process.env.COMPOSURECDK_DOMAIN;
  if (!apexDomain) {
    throw new Error(
      "custom-domain-website example requires a domain. Set COMPOSURECDK_DOMAIN " +
        "or pass --context domain=<your-domain>. See custom-domain-website/app.ts for setup.",
    );
  }
  const wwwDomain = `www.${apexDomain}`;

  const { stack } = createStackBuilder()
    .description("Static website at a custom domain with Route53 + ACM")
    .env({
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    })
    .build(app, "ComposureCDK-CustomDomainWebsiteStack");

  const hostedZone = HostedZone.fromLookup(stack, "Zone", { domainName: apexDomain });

  compose(
    {
      certificate: createCertificateBuilder()
        .domainName(apexDomain)
        .subjectAlternativeNames([wwwDomain])
        .validationZone(hostedZone),

      cdn: createDistributionBuilder()
        .comment("Custom-domain static website")
        .domainNames([apexDomain, wwwDomain])
        .certificate(ref("certificate", (r: CertificateBuilderResult) => r.certificate))
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
    {
      certificate: [],
      cdn: ["certificate"],
      apexA: ["cdn"],
      apexAaaa: ["cdn"],
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
          value: hostedZone.hostedZoneId,
          description: "Route 53 hosted zone ID",
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
