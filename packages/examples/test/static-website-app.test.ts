import { describe, it, expect } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createStaticWebsiteApp } from "../src/static-website/app.js";

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
          Comment: "Custom-domain static website",
        }),
      });
    });

    it("exposes both apex and www domain aliases wired to the ACM certificate", () => {
      const template = synthTemplate();
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: ["example.com", "www.example.com"],
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn: Match.anyValue(),
          }),
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
  });

  describe("Route 53 hosted zone", () => {
    it("creates exactly one public hosted zone for the apex", () => {
      const template = synthTemplate();
      template.resourceCountIs("AWS::Route53::HostedZone", 1);
      template.hasResourceProperties("AWS::Route53::HostedZone", {
        Name: "example.com.",
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
        DomainName: "example.com",
        SubjectAlternativeNames: ["www.example.com"],
        ValidationMethod: "DNS",
      });
    });
  });

  describe("stack", () => {
    it("has a descriptive stack description", () => {
      const template = synthTemplate();
      expect(template.toJSON().Description).toBe(
        "Static website on S3 + CloudFront with a custom domain and alerting",
      );
    });

    it("matches the expected synthesised template", () => {
      const template = synthTemplate();
      expect(template.toJSON()).toMatchSnapshot();
    });
  });
});
