import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  createDistributionBuilder,
  ORIGIN_OBJECT_EXPIRATION_WARNING_ID,
} from "@composurecdk/cloudfront";
import { createStaticWebsiteApp } from "../src/static-website/app.js";

const originExpirationWarnings = (stack: Stack): unknown[] =>
  Annotations.fromStack(stack).findWarning(
    "*",
    Match.stringLikeRegexp(ORIGIN_OBJECT_EXPIRATION_WARNING_ID),
  );

function synthTemplate(): Template {
  const { stack } = createStaticWebsiteApp();
  return Template.fromStack(stack);
}

describe("static-website-app", () => {
  describe("S3 bucket", () => {
    it("creates the site bucket plus logging buckets", () => {
      const template = synthTemplate();
      // 3 buckets: site bucket, S3 access logs bucket, CloudFront access logs bucket
      template.resourceCountIs("AWS::S3::Bucket", 3);
    });

    it("blocks all public access on all buckets", () => {
      const template = synthTemplate();
      const buckets = template.findResources("AWS::S3::Bucket");
      for (const bucket of Object.values(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        expect(props.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    });

    it("enables server-side encryption on all buckets", () => {
      const template = synthTemplate();
      const buckets = template.findResources("AWS::S3::Bucket");
      for (const bucket of Object.values(buckets)) {
        const props = (bucket as { Properties: Record<string, unknown> }).Properties;
        expect(props.BucketEncryption).toBeDefined();
      }
    });

    it("has a bucket policy allowing CloudFront OAC access", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "s3:GetObject",
              Effect: "Allow",
              Principal: {
                Service: "cloudfront.amazonaws.com",
              },
            }),
          ]),
        },
      });
    });

    it("has a bucket policy enforcing SSL", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "s3:*",
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
              Effect: "Deny",
            }),
          ]),
        },
      });
    });
  });

  describe("CloudFront distribution", () => {
    it("creates exactly one CloudFront distribution", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    it("uses PriceClass_100 for lowest cost", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          PriceClass: "PriceClass_100",
        }),
      });
    });

    it("redirects HTTP to HTTPS", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ViewerProtocolPolicy: "redirect-to-https",
          }),
        }),
      });
    });

    it("applies security response headers policy", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ResponseHeadersPolicyId: "67f7725c-6f97-4210-82d7-5512b31e9d03",
          }),
        }),
      });
    });

    it("uses HTTP/2 and HTTP/3", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          HttpVersion: "http2and3",
        }),
      });
    });

    it("enables access logging", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Logging: Match.objectLike({
            Bucket: Match.anyValue(),
          }),
        }),
      });
    });

    it("sets index.html as default root object", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultRootObject: "index.html",
        }),
      });
    });

    it("includes a descriptive comment", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Comment: "Example static website",
        }),
      });
    });

    it("creates a viewer-response function on the default behavior", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::CloudFront::Function", 2);
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: "viewer-response" }),
            ]),
          }),
        }),
      });
    });

    it("creates an additional /api/* behavior with its own viewer-request function", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: "/api/*",
              FunctionAssociations: Match.arrayWith([
                Match.objectLike({ EventType: "viewer-request" }),
              ]),
            }),
          ]),
        }),
      });
    });

    it("configures custom error responses for 403 and 404", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          CustomErrorResponses: [
            {
              ErrorCode: 403,
              ResponseCode: 404,
              ResponsePagePath: "/error.html",
            },
            {
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: "/error.html",
            },
          ],
        }),
      });
    });
  });

  describe("CloudFront Origin Access Control", () => {
    it("creates an OAC for S3", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
        OriginAccessControlConfig: Match.objectLike({
          OriginAccessControlOriginType: "s3",
          SigningBehavior: "always",
          SigningProtocol: "sigv4",
        }),
      });
    });

    /**
     * These two are the only coverage of the origin object-expiration guard
     * against a real `withOriginAccessControl` wiring. `S3BucketOrigin` is above
     * `@composurecdk/cloudfront`'s aws-cdk-lib floor, so that package's own suite
     * stands in an `HttpOrigin` on the same domain name; here the installed CDK
     * is not floor-pinned, so the genuine OAC path runs.
     *
     * The positive case is what keeps the negative one honest — a silence
     * assertion passes just as well when the guard never ran — and it pins the
     * rendering contract the guard depends on: that `S3BucketOrigin` resolves an
     * origin's `domainName` to an `Fn::GetAtt` naming the bucket.
     */
    it("warns when an OAC-wired origin bucket expires current versions", () => {
      const stack = new Stack(new App(), "OacGuard");
      const bucket = new Bucket(stack, "Site", {
        lifecycleRules: [{ id: "Nightly", expiration: Duration.days(90) }],
      });
      createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .build(stack, "Cdn");

      expect(originExpirationWarnings(stack)).not.toEqual([]);
    });

    /** A guard that cried wolf on the library's own example would be acknowledged away. */
    it("draws no such warning on this example, whose bucket uses the safe defaults", () => {
      const { stack } = createStaticWebsiteApp();

      expect(originExpirationWarnings(stack)).toEqual([]);
    });
  });

  describe("stack", () => {
    it("has a descriptive stack description", () => {
      const template = synthTemplate();
      expect(template.toJSON().Description).toBe("Static website hosted on S3 with CloudFront CDN");
    });

    it("matches the expected synthesised template", () => {
      const template = synthTemplate();
      expect(template.toJSON()).toMatchSnapshot();
    });
  });
});
