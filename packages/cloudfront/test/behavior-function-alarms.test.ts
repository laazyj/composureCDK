import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { S3BucketOrigin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { createDistributionBuilder } from "../src/distribution-builder.js";

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

function buildResult(
  configureFn: (builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createDistributionBuilder();
  configureFn(builder, stack);
  const result = builder.build(stack, "TestDistribution");
  return { result, template: Template.fromStack(stack) };
}

function withOrigin(builder: ReturnType<typeof createDistributionBuilder>, stack: Stack) {
  const bucket = new Bucket(stack, "TestBucket");
  builder
    .origin(S3BucketOrigin.withOriginAccessControl(bucket))
    .accessLogging(false)
    // Suppress only the distribution-level alarms so each test can focus on
    // function alarms. Note: `.recommendedAlarms(false)` would also disable
    // function alarms (master switch), which isn't what these tests want.
    .recommendedAlarms({ errorRate: false, originLatency: false });
}

describe("function alarms on default behavior", () => {
  it("creates execution/validation/throttles alarms by default", () => {
    const { result, template } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { result } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { result, template } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { template } = buildResult((b, stack) => {
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
    const { result, template } = buildResult((b, stack) => {
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
    const { result, template } = buildResult((b, stack) => {
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
    const { result, template } = buildResult((b, stack) => {
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
  function buildInRegion(
    region: string | undefined,
    configureFn: (b: ReturnType<typeof createDistributionBuilder>, stack: Stack) => void,
  ) {
    const app = new App();
    const stack =
      region === undefined
        ? new Stack(app, "TestStack")
        : new Stack(app, "TestStack", { env: { region, account: "123456789012" } });
    const builder = createDistributionBuilder();
    configureFn(builder, stack);
    builder.build(stack, "TestDistribution");
    return stack;
  }

  it("emits no warning when the stack is in us-east-1", () => {
    const stack = buildInRegion("us-east-1", (b, stack) => {
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

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("emits a synth-time warning when the stack is outside us-east-1 and alarms are created", () => {
    const stack = buildInRegion("us-west-2", (b, stack) => {
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

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp('deployed in "us-west-2"'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("emits no warning when no alarms are created, regardless of region", () => {
    const stack = buildInRegion("us-west-2", (b, stack) => {
      const bucket = new Bucket(stack, "TestBucket");
      b.origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .accessLogging(false)
        .recommendedAlarms(false);
    });

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });

  it("emits no warning when the stack region is an unresolved token (env-agnostic)", () => {
    const stack = buildInRegion(undefined, (b, stack) => {
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

    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("CloudFront metrics are emitted"),
    );
    expect(warnings).toHaveLength(0);
  });
});

describe("interactions with other alarm sources", () => {
  it("emits custom addAlarm() alarms alongside function alarms without key collisions", () => {
    const { result, template } = buildResult((b, stack) => {
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
    const { result } = buildResult((b, stack) => {
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
