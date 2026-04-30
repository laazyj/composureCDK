import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionCode, FunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { compose, ref } from "@composurecdk/core";
import { createDistributionBuilder } from "../src/distribution-builder.js";
import {
  createCloudFrontAlarmBuilder,
  type CloudFrontAlarmBuilderResult,
} from "../src/cloudfront-alarm-builder.js";
import type { DistributionBuilderResult } from "../src/distribution-builder.js";

const INLINE_CODE = `
  async function handler(event) {
    return event.request;
  }
`;

const viewerRequestFn = {
  eventType: FunctionEventType.VIEWER_REQUEST,
  code: FunctionCode.fromInline(INLINE_CODE),
};

// Builds a Distribution with no in-stack alarms (recommendedAlarms(false)) so
// the standalone alarm builder under test is the sole alarm source.
function buildDistribution(
  configureFn?: (builder: ReturnType<typeof createDistributionBuilder>) => void,
) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = createDistributionBuilder().recommendedAlarms(false);
  const bucket = new Bucket(stack, "TestBucket");
  builder.origin(S3BucketOrigin.withOriginAccessControl(bucket)).accessLogs(false);
  configureFn?.(builder);
  const result = builder.build(stack, "TestDistribution");
  return { app, stack, result };
}

describe("createCloudFrontAlarmBuilder", () => {
  describe("with a concrete DistributionBuilderResult", () => {
    it("creates the recommended distribution alarms in the alarm builder's scope", () => {
      const { stack, result } = buildDistribution();
      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.errorRate).toBeDefined();
      expect(alarmResult.alarms.originLatency).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates the per-function alarms in the alarm builder's scope", () => {
      const { stack, result } = buildDistribution((b) => {
        b.defaultBehavior({
          functions: [viewerRequestFn],
        });
      });

      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .build(stack, "Alarms");

      expect(alarmResult.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();
      expect(alarmResult.alarms.defaultBehaviorViewerRequestValidationErrors).toBeDefined();
      expect(alarmResult.alarms.defaultBehaviorViewerRequestThrottles).toBeDefined();
      // 2 dist alarms + 3 function alarms = 5
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 5);
    });

    it("honors per-function recommendedAlarms: false from the InlineFunctionDefinition", () => {
      const { stack, result } = buildDistribution((b) => {
        b.defaultBehavior({
          functions: [{ ...viewerRequestFn, recommendedAlarms: false }],
        });
      });

      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .recommendedAlarms(false)
        .build(stack, "Alarms");

      expect(alarmResult.alarms).toEqual({});
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("recommendedAlarms(false) suppresses both distribution-level and function alarms", () => {
      const { stack, result } = buildDistribution((b) => {
        b.defaultBehavior({
          functions: [viewerRequestFn],
        });
      });

      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .recommendedAlarms(false)
        .build(stack, "Alarms");

      expect(alarmResult.alarms).toEqual({});
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates custom addAlarm even when recommendedAlarms is false", () => {
      const { stack, result } = buildDistribution();
      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .recommendedAlarms(false)
        .addAlarm("custom4xx", (a) =>
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
        )
        .build(stack, "Alarms");

      expect(alarmResult.alarms.custom4xx).toBeDefined();
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates custom addAlarm alongside recommended alarms", () => {
      const { stack, result } = buildDistribution();
      const alarmResult = createCloudFrontAlarmBuilder()
        .distribution(result)
        .addAlarm("custom4xx", (a) =>
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
        )
        .build(stack, "Alarms");

      expect(alarmResult.alarms.custom4xx).toBeDefined();
      // 2 distribution alarms + 1 custom alarm
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 3);
    });

    it("throws when distribution() was never called", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const builder = createCloudFrontAlarmBuilder();
      expect(() => builder.build(stack, "Alarms")).toThrow(/requires a distribution/);
    });
  });

  describe("region warning", () => {
    function buildAlarmsInRegion(region: string | undefined): Stack {
      const app = new App();
      // Match env-shape so CDK can cross-reference. For the env-agnostic case
      // (region=undefined) both stacks are env-agnostic; for the resolved
      // cases, both use the same account with crossRegionReferences.
      const distStackProps =
        region === undefined
          ? undefined
          : {
              env: { region: "eu-west-2", account: "123456789012" },
              crossRegionReferences: true,
            };
      const distStack = new Stack(app, "DistStack", distStackProps);
      const bucket = new Bucket(distStack, "TestBucket");
      const result = createDistributionBuilder()
        .origin(S3BucketOrigin.withOriginAccessControl(bucket))
        .accessLogs(false)
        .recommendedAlarms(false)
        .defaultBehavior({
          functions: [viewerRequestFn],
        })
        .build(distStack, "TestDistribution");

      const alarmStack =
        region === undefined
          ? new Stack(app, "AlarmStack")
          : new Stack(app, "AlarmStack", {
              env: { region, account: "123456789012" },
              crossRegionReferences: true,
            });
      createCloudFrontAlarmBuilder().distribution(result).build(alarmStack, "Alarms");
      return alarmStack;
    }

    it("emits a warning when the alarm stack is outside us-east-1", () => {
      const stack = buildAlarmsInRegion("us-west-2");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp('deployed in "us-west-2"'),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("emits no warning when the alarm stack is in us-east-1", () => {
      const stack = buildAlarmsInRegion("us-east-1");
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("CloudFront metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });

    it("emits no warning when the alarm stack region is an unresolved token", () => {
      const stack = buildAlarmsInRegion(undefined);
      const warnings = Annotations.fromStack(stack).findWarning(
        "*",
        Match.stringLikeRegexp("CloudFront metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("with a Ref<DistributionBuilderResult> through compose", () => {
    it("resolves the distribution and creates the same alarm surface", () => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const bucket = new Bucket(stack, "TestBucket");

      const system = compose(
        {
          cdn: createDistributionBuilder()
            .origin(S3BucketOrigin.withOriginAccessControl(bucket))
            .accessLogs(false)
            .recommendedAlarms(false)
            .defaultBehavior({
              functions: [viewerRequestFn],
            }),

          cdnAlarms: createCloudFrontAlarmBuilder().distribution(
            ref<DistributionBuilderResult>("cdn"),
          ),
        },
        { cdn: [], cdnAlarms: ["cdn"] },
      );

      const result = system.build(stack, "Test") as {
        cdn: DistributionBuilderResult;
        cdnAlarms: CloudFrontAlarmBuilderResult;
      };

      // Distribution-side: no alarms
      expect(result.cdn.alarms).toEqual({});

      // Alarm-side: dist + function alarms
      expect(result.cdnAlarms.alarms.errorRate).toBeDefined();
      expect(result.cdnAlarms.alarms.originLatency).toBeDefined();
      expect(result.cdnAlarms.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();

      const template = Template.fromStack(stack);
      // 2 distribution alarms + 3 function alarms = 5
      template.resourceCountIs("AWS::CloudWatch::Alarm", 5);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
      template.resourceCountIs("AWS::CloudFront::Function", 1);
    });

    it("routes alarms into a separate stack when withStacks() points cdnAlarms elsewhere", () => {
      const app = new App();
      const siteStack = new Stack(app, "SiteStack", {
        env: { region: "eu-west-2", account: "123456789012" },
        crossRegionReferences: true,
      });
      const alarmStack = new Stack(app, "AlarmStack", {
        env: { region: "us-east-1", account: "123456789012" },
        crossRegionReferences: true,
      });
      const bucket = new Bucket(siteStack, "SiteBucket");

      compose(
        {
          cdn: createDistributionBuilder()
            .origin(S3BucketOrigin.withOriginAccessControl(bucket))
            .accessLogs(false)
            .recommendedAlarms(false)
            .defaultBehavior({
              functions: [viewerRequestFn],
            }),

          cdnAlarms: createCloudFrontAlarmBuilder().distribution(
            ref<DistributionBuilderResult>("cdn"),
          ),
        },
        { cdn: [], cdnAlarms: ["cdn"] },
      )
        .withStacks({
          cdn: siteStack,
          cdnAlarms: alarmStack,
        })
        .build(app, "MultiRegion");

      const siteTemplate = Template.fromStack(siteStack);
      const alarmTemplate = Template.fromStack(alarmStack);

      // Distribution lives in the site stack, no alarms there
      siteTemplate.resourceCountIs("AWS::CloudFront::Distribution", 1);
      siteTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 0);

      // Alarms live in the alarm stack, no distribution there
      alarmTemplate.resourceCountIs("AWS::CloudFront::Distribution", 0);
      alarmTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 5);

      // No region warning: alarm stack is us-east-1
      const warnings = Annotations.fromStack(alarmStack).findWarning(
        "*",
        Match.stringLikeRegexp("CloudFront metrics are emitted"),
      );
      expect(warnings).toHaveLength(0);
    });
  });
});

describe("DistributionBuilder.recommendedAlarms semantics", () => {
  it("defaults to true: dist + function alarms are created in the distribution's scope", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "TestBucket");
    const result = createDistributionBuilder()
      .origin(S3BucketOrigin.withOriginAccessControl(bucket))
      .accessLogs(false)
      .defaultBehavior({
        functions: [viewerRequestFn],
      })
      .build(stack, "Cdn");

    expect(result.alarms.errorRate).toBeDefined();
    expect(result.alarms.originLatency).toBeDefined();
    expect(result.alarms.defaultBehaviorViewerRequestExecutionErrors).toBeDefined();
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 5);
  });

  it("false suppresses both distribution-level and per-function alarms", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "TestBucket");
    const result = createDistributionBuilder()
      .origin(S3BucketOrigin.withOriginAccessControl(bucket))
      .accessLogs(false)
      .recommendedAlarms(false)
      .defaultBehavior({
        functions: [viewerRequestFn],
      })
      .build(stack, "Cdn");

    expect(result.alarms).toEqual({});
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("false does not suppress custom addAlarm() alarms", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "TestBucket");
    const result = createDistributionBuilder()
      .origin(S3BucketOrigin.withOriginAccessControl(bucket))
      .accessLogs(false)
      .recommendedAlarms(false)
      .addAlarm("custom4xx", (a) =>
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
      )
      .build(stack, "Cdn");

    expect(result.alarms.custom4xx).toBeDefined();
    Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("exposes function entries with behavior context for downstream alarm builders", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const bucket = new Bucket(stack, "TestBucket");
    const result = createDistributionBuilder()
      .origin(S3BucketOrigin.withOriginAccessControl(bucket))
      .accessLogs(false)
      .recommendedAlarms(false)
      .defaultBehavior({
        functions: [viewerRequestFn],
      })
      .behavior("/api/*", {
        origin: new HttpOrigin("api.example.com"),
        functions: [viewerRequestFn],
      })
      .build(stack, "Cdn");

    const entries = Object.values(result.functions);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.pathPattern)).toEqual([null, "/api/*"]);
    expect(entries.every((e) => e.eventType === FunctionEventType.VIEWER_REQUEST)).toBe(true);
  });
});
