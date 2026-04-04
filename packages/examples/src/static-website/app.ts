import { App, Duration } from "aws-cdk-lib";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { compose, ref } from "@composurecdk/core";
import { createStackBuilder, outputs } from "@composurecdk/cloudformation";
import {
  createBucketBuilder,
  createBucketDeploymentBuilder,
  type BucketBuilderResult,
} from "@composurecdk/s3";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";

/**
 * A static website hosted on S3 with CloudFront CDN, composed into a single stack.
 *
 * Demonstrates:
 * - S3 bucket configured for private access (no public website hosting)
 * - CloudFront distribution with Origin Access Control (OAC) for secure S3 access
 * - Cross-component reference using {@link ref} to wire the bucket as a CloudFront origin
 * - Automatic content deployment with CloudFront cache invalidation
 * - Custom error responses for 403/404 handling
 * - Cost-optimised defaults (PriceClass 100, HTTP→HTTPS redirect)
 *
 * Architecture:
 * ```
 * [Browser] → [CloudFront CDN] → [S3 Bucket (private)]
 *                    ↑
 *              Origin Access
 *                Control
 * ```
 */
export function createStaticWebsiteApp(app = new App()) {
  const { stack } = createStackBuilder()
    .description("Static website hosted on S3 with CloudFront CDN")
    .build(app, "ComposureCDK-StaticWebsiteStack");

  compose(
    {
      site: createBucketBuilder().versioned(false),

      cdn: createDistributionBuilder()
        .comment("Example static website")
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
        ]),

      deploy: createBucketDeploymentBuilder()
        .sources([Source.asset("./src/static-website/site")])
        .destinationBucket(ref("site", (r: BucketBuilderResult) => r.bucket))
        .distribution(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
    },
    { site: [], cdn: ["site"], deploy: ["site", "cdn"] },
  )
    .afterBuild(
      outputs({
        DistributionUrl: {
          value: ref(
            "cdn",
            (r: DistributionBuilderResult) => `https://${r.distribution.distributionDomainName}`,
          ),
          description: "CloudFront distribution URL",
        },
        BucketName: {
          value: ref("site", (r: BucketBuilderResult) => r.bucket.bucketName),
          description: "S3 bucket name for site content",
        },
      }),
    )
    .build(stack, "StaticWebsite");

  return { stack };
}
