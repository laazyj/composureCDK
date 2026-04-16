import { App, Duration } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder } from "@composurecdk/sns";
import { createStackBuilder, outputs } from "@composurecdk/cloudformation";
import { createCertificateBuilder, type CertificateBuilderResult } from "@composurecdk/acm";
import {
  createBucketBuilder,
  createBucketDeploymentBuilder,
  type BucketBuilderResult,
} from "@composurecdk/s3";
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
 * A production-ready static website at a custom domain: S3 origin fronted by
 * CloudFront, with Route 53 DNS, a DNS-validated ACM certificate, recommended
 * alarms on both S3 and CloudFront, and SNS alerting.
 *
 * Everything is declared in a single {@link compose} graph — every
 * cross-component dependency is expressed as a {@link ref}, so the dependency
 * resolver enforces build order (zone → cert → cdn → records, cdn → deploy).
 *
 * Demonstrates:
 * - S3 bucket as a private CloudFront origin via Origin Access Control (OAC).
 * - Bucket deployment with automatic CloudFront cache invalidation.
 * - Route 53 public hosted zone + ACM certificate with DNS validation wired
 *   to that zone through a {@link ref}.
 * - CloudFront distribution at the apex + `www` custom domain, with the
 *   certificate pulled through context.
 * - Apex A/AAAA alias records using {@link cloudfrontAliasTarget}.
 * - SNS topic wired via an `afterBuild` hook so every recommended S3 and
 *   CloudFront alarm posts to the same notification channel.
 *
 * Architecture:
 * ```
 * [Browser] → [Route 53] → [CloudFront + ACM cert] → [S3 Bucket (private)]
 *                                ↑                          ↑
 *                         custom domain              Origin Access Control
 * ```
 *
 * Note: CloudFront viewer certificates must live in `us-east-1`. This example
 * places the whole stack in the default environment — in production, you'd
 * either deploy the stack to `us-east-1` or split the certificate into a
 * dedicated `us-east-1` stack and wire it across via cross-region references.
 */
export function createStaticWebsiteApp(app = new App()) {
  const { stack } = createStackBuilder()
    .description("Static website on S3 + CloudFront with a custom domain and alerting")
    .build(app, "ComposureCDK-StaticWebsiteStack");

  const apexDomain = "example.com";
  const wwwDomain = `www.${apexDomain}`;

  compose(
    {
      alerts: createTopicBuilder().displayName("Static Website Alerts"),

      zone: createHostedZoneBuilder()
        .zoneName(apexDomain)
        .comment("Primary customer-facing domain"),

      certificate: createCertificateBuilder()
        .domainName(apexDomain)
        .subjectAlternativeNames([wwwDomain])
        .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone)),

      site: createBucketBuilder()
        .versioned(false)
        .metrics([{ id: "EntireBucket" }])
        .recommendedAlarms({
          // Tolerate some client errors (e.g. 404s from crawlers)
          clientErrors: { threshold: 50 },
        }),

      cdn: createDistributionBuilder()
        .comment("Custom-domain static website")
        .domainNames([apexDomain, wwwDomain])
        .certificate(ref("certificate", (r: CertificateBuilderResult) => r.certificate))
        .origin(
          ref("site", (r: BucketBuilderResult) => S3BucketOrigin.withOriginAccessControl(r.bucket)),
        )
        .errorResponses([
          {
            httpStatus: 403,
            responsePagePath: "/error.html",
            responseHttpStatus: 404,
            ttl: Duration.seconds(60),
          },
          {
            httpStatus: 404,
            responsePagePath: "/error.html",
            responseHttpStatus: 404,
            ttl: Duration.seconds(60),
          },
        ])
        .recommendedAlarms({
          // Tighter error rate threshold for a production website
          errorRate: { threshold: 2 },
        }),

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

      deploy: createBucketDeploymentBuilder()
        .sources([Source.asset("./src/static-website/site")])
        .destinationBucket(ref("site", (r: BucketBuilderResult) => r.bucket))
        .distribution(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
    },
    {
      alerts: [],
      zone: [],
      certificate: ["zone"],
      site: [],
      cdn: ["certificate", "site"],
      apexA: ["zone", "cdn"],
      apexAaaa: ["zone", "cdn"],
      deploy: ["site", "cdn"],
    },
  )
    .afterBuild((_scope, _id, results) => {
      // Apply SNS actions to all alarms across S3 and CloudFront components
      const allAlarms = [results.site.alarms, results.cdn.alarms].flatMap((alarms) =>
        Object.values(alarms),
      );
      const action = new SnsAction(results.alerts.topic);
      for (const alarm of allAlarms) {
        alarm.addAlarmAction(action);
      }
    })
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
        BucketName: {
          value: ref("site", (r: BucketBuilderResult) => r.bucket.bucketName),
          description: "S3 bucket name for site content",
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
    .build(stack, "StaticWebsite");

  return { stack };
}
