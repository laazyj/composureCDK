import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { S3BucketOrigin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  CachePolicy,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  ImportSource,
  KeyValueStore,
} from "aws-cdk-lib/aws-cloudfront";
import { ref } from "@composurecdk/core";
import { type BucketBuilderResult } from "@composurecdk/s3";
import { createDistributionBuilder } from "../src/distribution-builder.js";

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

function withBucketOrigin(stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  return S3BucketOrigin.withOriginAccessControl(bucket);
}

function synthTemplate(
  configureFn: (builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createDistributionBuilder();
  configureFn(builder, stack);
  const result = builder.build(stack, "TestDistribution");
  return { result, template: Template.fromStack(stack) };
}

describe("default behavior inline functions", () => {
  it("creates a CloudFront Function for an inline function on the default behavior", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    template.resourceCountIs("AWS::CloudFront::Function", 1);
  });

  it("wires the function into the default behavior's FunctionAssociations", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

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

  it("returns the CfFunction in the build result under the behavior+event key", () => {
    const { result } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    expect(result.functions.defaultBehaviorViewerRequest).toBeDefined();
  });

  it("defaults the runtime to cloudfront-js-2.0", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionConfig: Match.objectLike({
        Runtime: "cloudfront-js-2.0",
      }),
    });
  });

  it("honours a user-provided runtime", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
              runtime: FunctionRuntime.JS_1_0,
            },
          ],
        });
    });

    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionConfig: Match.objectLike({
        Runtime: "cloudfront-js-1.0",
      }),
    });
  });

  it("applies a provided comment to the Function", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
              comment: "URI rewrite",
            },
          ],
        });
    });

    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionConfig: Match.objectLike({ Comment: "URI rewrite" }),
    });
  });

  it("associates a KeyValueStore with the Function", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const kvs = new KeyValueStore(stack, "Kvs", {
      source: ImportSource.fromInline(JSON.stringify({ data: [{ key: "a", value: "b" }] })),
    });

    createDistributionBuilder()
      .origin(withBucketOrigin(stack))
      .accessLogging(false)
      .recommendedAlarms(false)
      .defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            keyValueStore: kvs,
          },
        ],
      })
      .build(stack, "TestDistribution");

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudFront::Function", {
      FunctionConfig: Match.objectLike({
        KeyValueStoreAssociations: Match.arrayWith([
          Match.objectLike({ KeyValueStoreARN: Match.anyValue() }),
        ]),
      }),
    });
  });

  it("supports functions on both viewer-request and viewer-response", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
            {
              eventType: FunctionEventType.VIEWER_RESPONSE,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    template.resourceCountIs("AWS::CloudFront::Function", 2);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
            Match.objectLike({ EventType: "viewer-response" }),
          ]),
        }),
      }),
    });
  });

  it("throws when two functions share the same eventType on the default behavior", () => {
    expect(() =>
      synthTemplate((b, stack) => {
        b.origin(withBucketOrigin(stack))
          .accessLogging(false)
          .recommendedAlarms(false)
          .defaultBehavior({
            functions: [
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                code: FunctionCode.fromInline(INLINE_CODE),
              },
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                code: FunctionCode.fromInline(INLINE_CODE),
              },
            ],
          });
      }),
    ).toThrow(/default behavior has multiple functions for eventType "viewer-request"/);
  });

  it("creates no function resources when functions is omitted or empty", () => {
    const { result, template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .defaultBehavior({ functions: [] });
    });

    template.resourceCountIs("AWS::CloudFront::Function", 0);
    expect(Object.keys(result.functions)).toHaveLength(0);
  });

  it("emits no FunctionAssociations on the default behavior when functions is omitted", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack)).accessLogging(false).recommendedAlarms(false);
    });

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: Match.absent(),
        }),
      }),
    });
  });

  it("throws when keyValueStore is used with a non-JS_2_0 runtime", () => {
    expect(() =>
      synthTemplate((b, stack) => {
        const kvs = new KeyValueStore(stack, "Kvs", {
          source: ImportSource.fromInline(JSON.stringify({ data: [{ key: "a", value: "b" }] })),
        });
        b.origin(withBucketOrigin(stack))
          .accessLogging(false)
          .recommendedAlarms(false)
          .defaultBehavior({
            functions: [
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                code: FunctionCode.fromInline(INLINE_CODE),
                runtime: FunctionRuntime.JS_1_0,
                keyValueStore: kvs,
              },
            ],
          });
      }),
    ).toThrow(/keyValueStore, which requires FunctionRuntime.JS_2_0/);
  });
});

describe("additional path-pattern behaviors", () => {
  it("creates an additional cache behavior with its own origin", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .behavior("/api/*", {
          origin: new HttpOrigin("api.example.com"),
          cachePolicy: CachePolicy.CACHING_DISABLED,
        });
    });

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: "/api/*",
          }),
        ]),
      }),
    });
  });

  it("creates an inline function on an additional behavior", () => {
    const { result, template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .behavior("/api/*", {
          origin: new HttpOrigin("api.example.com"),
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    template.resourceCountIs("AWS::CloudFront::Function", 1);
    expect(result.functions.behaviorApiSlashStarViewerRequest).toBeDefined();
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

  it("supports multiple additional behaviors with independent functions", () => {
    const { result, template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack))
        .accessLogging(false)
        .recommendedAlarms(false)
        .behavior("/api/*", {
          origin: new HttpOrigin("api.example.com"),
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        })
        .behavior("*.html", {
          origin: new HttpOrigin("pages.example.com"),
          functions: [
            {
              eventType: FunctionEventType.VIEWER_RESPONSE,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
    });

    template.resourceCountIs("AWS::CloudFront::Function", 2);
    expect(result.functions.behaviorApiSlashStarViewerRequest).toBeDefined();
    expect(result.functions.behaviorStarHtmlViewerResponse).toBeDefined();
  });

  it("throws when the same path pattern is added twice", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const builder = createDistributionBuilder()
      .origin(withBucketOrigin(stack))
      .accessLogging(false)
      .recommendedAlarms(false)
      .behavior("/api/*", { origin: new HttpOrigin("api.example.com") });

    expect(() =>
      builder.behavior("/api/*", { origin: new HttpOrigin("api-2.example.com") }),
    ).toThrow(/behavior for path pattern "\/api\/\*" is already defined/);
  });

  it("throws when two functions on the same additional behavior share an eventType", () => {
    expect(() =>
      synthTemplate((b, stack) => {
        b.origin(withBucketOrigin(stack))
          .accessLogging(false)
          .recommendedAlarms(false)
          .behavior("/api/*", {
            origin: new HttpOrigin("api.example.com"),
            functions: [
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                code: FunctionCode.fromInline(INLINE_CODE),
              },
              {
                eventType: FunctionEventType.VIEWER_REQUEST,
                code: FunctionCode.fromInline(INLINE_CODE),
              },
            ],
          });
      }),
    ).toThrow(/behavior "\/api\/\*" has multiple functions for eventType "viewer-request"/);
  });

  it("resolves a Resolvable origin on an additional behavior from compose context", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const apiBucket = new Bucket(stack, "ApiBucket");

    const result = createDistributionBuilder()
      .origin(withBucketOrigin(stack))
      .accessLogging(false)
      .recommendedAlarms(false)
      .behavior("/api/*", {
        origin: ref<BucketBuilderResult>("api").map((r) =>
          S3BucketOrigin.withOriginAccessControl(r.bucket),
        ),
      })
      .build(stack, "TestDistribution", {
        api: { bucket: apiBucket },
      });

    expect(result.distribution).toBeDefined();
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: "/api/*" })]),
      }),
    });
  });

  it("creates no CacheBehaviors when no additional behaviors are added", () => {
    const { template } = synthTemplate((b, stack) => {
      b.origin(withBucketOrigin(stack)).accessLogging(false).recommendedAlarms(false);
    });

    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.absent(),
      }),
    });
  });
});
