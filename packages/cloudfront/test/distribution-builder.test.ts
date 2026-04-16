import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  CachePolicy,
  FunctionCode,
  FunctionEventType,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ref } from "@composurecdk/core";
import { type BucketBuilderResult } from "@composurecdk/s3";
import { createDistributionBuilder } from "../src/distribution-builder.js";
import { createFunctionBuilder, type FunctionBuilderResult } from "../src/function-builder.js";

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createDistributionBuilder();
  configureFn(builder, stack);
  builder.build(stack, "TestDistribution");
  return Template.fromStack(stack);
}

function withBucketOrigin(stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  return S3BucketOrigin.withOriginAccessControl(bucket);
}

describe("DistributionBuilder", () => {
  describe("build", () => {
    it("returns a DistributionBuilderResult with a distribution property", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");
      const origin = S3BucketOrigin.withOriginAccessControl(bucket);

      const builder = createDistributionBuilder().origin(origin).accessLogging(false);
      const result = builder.build(stack, "TestDistribution");

      expect(result).toBeDefined();
      expect(result.distribution).toBeDefined();
    });

    it("throws when no origin is provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createDistributionBuilder();

      expect(() => builder.build(stack, "TestDistribution")).toThrow(/requires an origin/);
    });
  });

  describe("synthesised output", () => {
    it("creates a CloudFront distribution", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    it("creates a distribution with a comment", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).comment("My website"),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Comment: "My website",
        }),
      });
    });

    it("creates a distribution with custom error responses", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).errorResponses([
          {
            httpStatus: 404,
            responsePagePath: "/index.html",
            responseHttpStatus: 200,
          },
        ]),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          CustomErrorResponses: [
            {
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            },
          ],
        }),
      });
    });

    it("allows the user to enable or disable the distribution", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).enabled(false),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Enabled: false,
        }),
      });
    });
  });

  describe("secure defaults", () => {
    it("uses PriceClass 100 by default", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          PriceClass: "PriceClass_100",
        }),
      });
    });

    it("redirects HTTP to HTTPS by default", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ViewerProtocolPolicy: "redirect-to-https",
          }),
        }),
      });
    });

    it("sets index.html as default root object", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultRootObject: "index.html",
        }),
      });
    });

    it("uses HTTP/2 and HTTP/3 by default", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          HttpVersion: "http2and3",
        }),
      });
    });

    it("requires TLS 1.2 minimum protocol version by default", () => {
      const template = synthTemplate((b, stack) => {
        const cert = Certificate.fromCertificateArn(
          stack,
          "Cert",
          "arn:aws:acm:us-east-1:123456789012:certificate/abc",
        );
        b.origin(withBucketOrigin(stack)).certificate(cert).domainNames(["example.com"]);
      });

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          ViewerCertificate: Match.objectLike({
            MinimumProtocolVersion: "TLSv1.2_2021",
          }),
        }),
      });
    });

    it("applies security response headers policy by default", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ResponseHeadersPolicyId: "67f7725c-6f97-4210-82d7-5512b31e9d03",
          }),
        }),
      });
    });

    it("enables access logging by default", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Logging: Match.objectLike({
            Bucket: Match.anyValue(),
          }),
        }),
      });
    });

    it("creates a logging bucket with secure defaults", () => {
      const template = synthTemplate((b, stack) => b.origin(withBucketOrigin(stack)));

      // The auto-created logging bucket should have secure defaults from BucketBuilder
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: Match.objectLike({
          ServerSideEncryptionConfiguration: Match.anyValue(),
        }),
      });
    });

    it("returns the access logs bucket in the build result", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");
      const origin = S3BucketOrigin.withOriginAccessControl(bucket);

      const result = createDistributionBuilder().origin(origin).build(stack, "TestDistribution");

      expect(result.accessLogsBucket).toBeDefined();
    });

    it("skips access logging when disabled", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");
      const origin = S3BucketOrigin.withOriginAccessControl(bucket);

      const result = createDistributionBuilder()
        .origin(origin)
        .accessLogging(false)
        .build(stack, "TestDistribution");

      expect(result.accessLogsBucket).toBeUndefined();
    });

    it("skips auto-created logging bucket when logBucket is provided", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");
      const logBucket = new Bucket(stack, "LogBucket");
      const origin = S3BucketOrigin.withOriginAccessControl(bucket);

      const result = createDistributionBuilder()
        .origin(origin)
        .logBucket(logBucket)
        .build(stack, "TestDistribution");

      expect(result.accessLogsBucket).toBeUndefined();
    });

    it("allows the user to override price class", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).priceClass(PriceClass.PRICE_CLASS_ALL),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          PriceClass: "PriceClass_All",
        }),
      });
    });
  });

  describe("defaultBehavior override", () => {
    it("preserves user-provided behavior options alongside secure defaults", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).defaultBehavior({
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        }),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            // User-provided
            Compress: true,
            // Secure default still applied
            ViewerProtocolPolicy: "redirect-to-https",
          }),
        }),
      });
    });

    it("allows overriding viewer protocol policy", () => {
      const template = synthTemplate((b, stack) =>
        b.origin(withBucketOrigin(stack)).defaultBehavior({
          viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL,
        }),
      );

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            ViewerProtocolPolicy: "allow-all",
          }),
        }),
      });
    });
  });

  describe("ref support", () => {
    it("resolves origin from context when using a Ref", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");

      const builder = createDistributionBuilder()
        .origin(
          ref<BucketBuilderResult>("site").map((r) =>
            S3BucketOrigin.withOriginAccessControl(r.bucket),
          ),
        )
        .accessLogging(false);

      const result = builder.build(stack, "TestDistribution", {
        site: { bucket },
      });

      expect(result.distribution).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Origins: Match.arrayWith([
            Match.objectLike({
              S3OriginConfig: Match.anyValue(),
            }),
          ]),
        }),
      });
    });

    it("resolves functionAssociations.function from context when using a Ref", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");

      const functionResult = createFunctionBuilder()
        .code(FunctionCode.fromInline("async function handler(e){return e.request}"))
        .recommendedAlarms(false)
        .build(stack, "Rewrite");

      const builder = createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .accessLogging(false)
        .defaultBehavior({
          functionAssociations: [
            {
              function: ref<FunctionBuilderResult>("rewrite").map((r) => r.function),
              eventType: FunctionEventType.VIEWER_REQUEST,
            },
          ],
        });

      const result = builder.build(stack, "TestDistribution", {
        rewrite: functionResult,
      });

      expect(result.distribution).toBeDefined();
      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({
                EventType: "viewer-request",
                FunctionARN: Match.anyValue(),
              }),
            ]),
          }),
        }),
      });
    });

    it("accepts a concrete IFunctionRef in functionAssociations (non-Ref)", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");

      const { function: fn } = createFunctionBuilder()
        .code(FunctionCode.fromInline("async function handler(e){return e.request}"))
        .recommendedAlarms(false)
        .build(stack, "Rewrite");

      createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .accessLogging(false)
        .defaultBehavior({
          functionAssociations: [{ function: fn, eventType: FunctionEventType.VIEWER_RESPONSE }],
        })
        .build(stack, "TestDistribution");

      const template = Template.fromStack(stack);
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
  });
});
