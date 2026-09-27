import { describe, it, expect } from "vitest";
import { Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { buildFixture, testEnv } from "@composurecdk/cdk-testing";
import { createDistributionBuilder } from "../src/distribution-builder.js";

const buildAndSynth = buildFixture(createDistributionBuilder, "TestDistribution");

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

function withOrigin(builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  builder
    .origin(new HttpOrigin(bucket.bucketRegionalDomainName))
    .accessLogs(false)
    // Suppress only the distribution-level alarms so each test can focus on
    // function alarms. Note: `.recommendedAlarms(false)` would also disable
    // function alarms (master switch), which isn't what these tests want.
    .recommendedAlarms({ errorRate: false, originLatency: false });
}

describe("function alarms on default behavior", () => {
  it("creates execution/validation/throttles alarms by default", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestValidationErrors).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestThrottles).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("creates execution-errors alarm with the correct shape", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionExecutionErrors",
      Namespace: "AWS/CloudFront",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      Statistic: "Sum",
      Period: 60,
      TreatMissingData: "notBreaching",
    });
  });

  it("includes FunctionName and Region=Global dimensions", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionExecutionErrors",
      Dimensions: Match.arrayWith([
        Match.objectLike({ Name: "FunctionName" }),
        Match.objectLike({ Name: "Region", Value: "Global" }),
      ]),
    });
  });

  it("scopes alarm descriptions to the default behavior and event type", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionExecutionErrors",
      AlarmDescription: Match.stringLikeRegexp(
        "default behavior \\(viewer-request\\).*Threshold: > 0",
      ),
    });
  });
});

describe("function alarms on additional behaviors", () => {
  it("scopes alarm keys to the path pattern and event type", () => {
    const { result } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.behavior("/api/*", {
        origin: new HttpOrigin("api.example.com"),
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    expect(result.alarms.behaviorApiSlashStarViewerRequestExecutionErrors).toBeDefined();
    expect(result.alarms.behaviorApiSlashStarViewerRequestValidationErrors).toBeDefined();
    expect(result.alarms.behaviorApiSlashStarViewerRequestThrottles).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeUndefined();
  });

  it("includes the path pattern in alarm descriptions", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.behavior("/api/*", {
        origin: new HttpOrigin("api.example.com"),
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionExecutionErrors",
      AlarmDescription: Match.stringLikeRegexp('behavior "/api/\\*" \\(viewer-request\\)'),
    });
  });

  it("emits independent alarms for the same event type across different behaviors", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      }).behavior("/api/*", {
        origin: new HttpOrigin("api.example.com"),
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    // Two CfFunctions × 3 alarms each = 6 function alarms (distribution alarms disabled).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 6);
    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();
    expect(result.alarms.behaviorApiSlashStarViewerRequestExecutionErrors).toBeDefined();
  });
});

describe("customization", () => {
  it("allows per-function threshold overrides", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            recommendedAlarms: { throttles: { threshold: 5 } },
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionThrottles",
      Threshold: 5,
    });
  });

  it("allows per-function treatMissingData overrides", () => {
    const { template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            recommendedAlarms: {
              validationErrors: { treatMissingData: TreatMissingData.BREACHING },
            },
          },
        ],
      });
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "FunctionValidationErrors",
      TreatMissingData: "breaching",
    });
  });
});

describe("disabling", () => {
  it("disables all three alarms for a function when recommendedAlarms is false", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            recommendedAlarms: false,
          },
        ],
      });
    });

    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeUndefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("disables all three alarms when enabled: false", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            recommendedAlarms: { enabled: false },
          },
        ],
      });
    });

    expect(result.alarms).toEqual({});
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("disables a single alarm while keeping the others", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
            recommendedAlarms: { executionErrors: false },
          },
        ],
      });
    });

    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeUndefined();
    expect(result.alarms.defaultBehaviorViewerRequestValidationErrors).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestThrottles).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

describe("region signposting", () => {
  it("emits no warning when the stack is in us-east-1", () => {
    const { stack } = buildAndSynth(
      (b, stack) => {
        withOrigin(b, stack);
        b.defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
      },
      { stackProps: { env: testEnv("us-east-1") } },
    );

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("emits a synth-time warning when the stack is outside us-east-1 and alarms are created", () => {
    const { stack } = buildAndSynth(
      (b, stack) => {
        withOrigin(b, stack);
        b.defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
      },
      { stackProps: { env: testEnv("us-west-2") } },
    );

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp('deployed in "us-west-2"'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("emits no warning when no alarms are created, regardless of region", () => {
    const { stack } = buildAndSynth(
      (b, stack) => {
        const bucket = new Bucket(stack, "TestBucket");
        b.origin(new HttpOrigin(bucket.bucketRegionalDomainName))
          .accessLogs(false)
          .recommendedAlarms(false);
      },
      { stackProps: { env: testEnv("us-west-2") } },
    );

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("emits no warning when the stack region is an unresolved token (env-agnostic)", () => {
    const { stack } = buildAndSynth(
      (b, stack) => {
        withOrigin(b, stack);
        b.defaultBehavior({
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              code: FunctionCode.fromInline(INLINE_CODE),
            },
          ],
        });
      },
      { stackProps: {} },
    );

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });
});

describe("interactions with other alarm sources", () => {
  it("emits custom addAlarm() alarms alongside function alarms without key collisions", () => {
    const { result, template } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.defaultBehavior({
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      }).addAlarm("custom4xx", (a) =>
        a
          .metric(
            () =>
              new Metric({
                namespace: "AWS/CloudFront",
                metricName: "4xxErrorRate",
                statistic: "Average",
              }),
          )
          .threshold(5)
          .greaterThan(),
      );
    });

    // 3 function alarms + 1 custom alarm (distribution alarms disabled via recommendedAlarms(false))
    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestValidationErrors).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestThrottles).toBeDefined();
    expect(result.alarms.custom4xx).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
  });

  it("emits distinct alarm keys for path patterns that would otherwise collide on slug", () => {
    const { result } = buildAndSynth((b, stack) => {
      withOrigin(b, stack);
      b.behavior("/api/*", {
        origin: new HttpOrigin("api.example.com"),
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      }).behavior("/api*", {
        origin: new HttpOrigin("api-legacy.example.com"),
        functions: [
          {
            eventType: FunctionEventType.VIEWER_REQUEST,
            code: FunctionCode.fromInline(INLINE_CODE),
          },
        ],
      });
    });

    // `/api/*` → ApiSlashStar, `/api*` → ApiStar — the two patterns must not
    // produce the same slug, otherwise createAlarms would throw on duplicate keys.
    expect(result.alarms.behaviorApiSlashStarViewerRequestExecutionErrors).toBeDefined();
    expect(result.alarms.behaviorApiStarViewerRequestExecutionErrors).toBeDefined();
  });
});
