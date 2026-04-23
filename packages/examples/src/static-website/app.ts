import { App, Duration } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { CachePolicy, FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { compose, ref } from "@composurecdk/core";
import { createTopicBuilder } from "@composurecdk/sns";
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
 * - An inline CloudFront Function on the default behavior (viewer-response
 *   header injection) and a path-pattern behavior (`/api/*` → HTTP origin)
 *   with its own viewer-request function. Both functions get path-scoped
 *   recommended alarms (FunctionExecutionErrors / ValidationErrors / Throttles)
 *   emitted automatically by the builder.
 * - Automatic content deployment with CloudFront cache invalidation
 * - Custom error responses for 403/404 handling
 * - Cost-optimised defaults (PriceClass 100, HTTP→HTTPS redirect)
 * - Recommended CloudWatch alarms for CloudFront (5xx error rate, origin latency)
 * - S3 bucket alarms (5xx/4xx errors) with request metrics filter
 * - Using TopicBuilder for the alert topic with recommended alarms
 * - Applying alarm actions via afterBuild hook
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
      alerts: createTopicBuilder().displayName("Static Website Alerts"),

      site: createBucketBuilder()
        .versioned(false)
        .metrics([{ id: "EntireBucket" }])
        .recommendedAlarms({
          // Tolerate some client errors (e.g. 404s from crawlers)
          clientErrors: { threshold: 50 },
        }),

      cdn: createDistributionBuilder()
        .comment("Example static website")
        .origin(
          ref("site", (r: BucketBuilderResult) => S3BucketOrigin.withOriginAccessControl(r.bucket)),
        )
        // Inline CloudFront Function on the default behavior: add a
        // permissive-but-informative `x-served-by` response header on every
        // response from the origin. The builder creates the Function construct,
        // wires it into FunctionAssociations, and emits
        // FunctionExecutionErrors/ValidationErrors/Throttles alarms keyed by
        // `defaultBehaviorViewerResponse*`.
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_RESPONSE,
              code: FunctionCode.fromInline(`
                function handler(event) {
                  var response = event.response;
                  response.headers["x-served-by"] = { value: "composurecdk-example" };
                  return response;
                }
              `),
              comment: "Add x-served-by header",
            },
          ],
        })
        // Path-pattern behavior: `/api/*` routes to a separate HTTP origin with
        // caching disabled. Its own viewer-request function strips any inbound
        // `authorization` header before the request reaches the origin.
        // Alarms for this function are keyed by `behaviorApiSlashStar*`, so
        // they page independently of the default behavior's function.
        .behavior("/api/*", {
          origin: new HttpOrigin("api.example.com"),
          cachePolicy: CachePolicy.CACHING_DISABLED,
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(`
                function handler(event) {
                  var request = event.request;
                  delete request.headers["authorization"];
                  return request;
                }
              `),
              comment: "Strip Authorization header before forwarding to API origin",
            },
          ],
        })
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

      deploy: createBucketDeploymentBuilder()
        .sources([Source.asset("./src/static-website/site")])
        .destinationBucket(ref("site", (r: BucketBuilderResult) => r.bucket))
        .distribution(ref("cdn", (r: DistributionBuilderResult) => r.distribution)),
    },
    { alerts: [], site: [], cdn: ["site"], deploy: ["site", "cdn"] },
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
