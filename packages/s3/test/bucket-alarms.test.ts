import { describe, it, expect } from "vitest";
import { Duration } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { type Alarm, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { assertAssignable, buildFixture, newStack } from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { compose, ref } from "@composurecdk/core";
import { type BucketBuilderResult, createBucketBuilder } from "../src/bucket-builder.js";
import { resolveBucketAlarmDefinitions } from "../src/bucket-alarms.js";

const buildAndSynth = buildFixture(createBucketBuilder, "TestBucket");

function withAlarms(builder: ReturnType<typeof createBucketBuilder>) {
  builder.serverAccessLogs(false).metrics([{ id: "EntireBucket" }]);
}

function customAlarm(builder: ReturnType<typeof createBucketBuilder>) {
  return builder.serverAccessLogs(false).addAlarm("totalRequests", (alarm) =>
    alarm
      .metric(
        (bucket) =>
          new Metric({
            namespace: "AWS/S3",
            metricName: "GetRequests",
            dimensionsMap: { BucketName: bucket.bucketName, FilterId: "EntireBucket" },
            period: Duration.minutes(5),
          }),
      )
      .threshold(100)
      .lessThan()
      .description("Bucket traffic has dropped below expected level"),
  );
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates no alarms without metrics configured", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates serverErrors and clientErrors alarms when metrics are configured", () => {
      const { result, template } = buildAndSynth(withAlarms);

      expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("creates alarms for each metrics configuration", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false).metrics([
          { id: "EntireBucket" },
          { id: "UploadsOnly", prefix: "uploads/" },
        ]);
      });

      expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      expect(result.alarms["serverErrors:UploadsOnly"]).toBeDefined();
      expect(result.alarms["clientErrors:UploadsOnly"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    });

    it("creates serverErrors alarm with threshold > 0", () => {
      const { template } = buildAndSynth(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Namespace: "AWS/S3",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 300,
      });
    });

    it("creates clientErrors alarm with threshold > 0", () => {
      const { template } = buildAndSynth(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4xxErrors",
        Namespace: "AWS/S3",
        Threshold: 0,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Sum",
        Period: 300,
      });
    });

    it("includes FilterId dimension from metrics configuration", () => {
      const { template } = buildAndSynth((b) => {
        b.serverAccessLogs(false).metrics([{ id: "MyFilter" }]);
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "FilterId", Value: "MyFilter" })]),
      });
    });

    it("includes threshold justification in alarm descriptions", () => {
      const { template } = buildAndSynth(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 0"),
      });
    });
  });

  describe("customization", () => {
    it("allows customizing serverErrors alarm threshold", () => {
      const { template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: { threshold: 10 },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        Threshold: 10,
      });
    });

    it("allows customizing evaluation periods", () => {
      const { template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            clientErrors: { evaluationPeriods: 5, datapointsToAlarm: 3 },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "4xxErrors",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 3,
      });
    });

    it("allows customizing treat missing data", () => {
      const { template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: { treatMissingData: TreatMissingData.BREACHING },
          });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        TreatMissingData: "breaching",
      });
    });
  });

  describe("disabling alarms", () => {
    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            enabled: false,
          });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables individual alarms when set to false", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: false,
          });
      });

      expect(result.alarms["serverErrors:EntireBucket"]).toBeUndefined();
      expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("disables multiple individual alarms", () => {
      const { result, template } = buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .recommendedAlarms({
            serverErrors: false,
            clientErrors: false,
          });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("no default actions", () => {
    it("creates alarms with no alarm actions", () => {
      const { template } = buildAndSynth(withAlarms);

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "5xxErrors",
        AlarmActions: Match.absent(),
      });
    });
  });
});

describe("addAlarm", () => {
  it("creates a custom alarm alongside recommended alarms", () => {
    const { result, template } = buildAndSynth((b) => {
      b.serverAccessLogs(false)
        .metrics([{ id: "EntireBucket" }])
        .addAlarm("totalRequests", (alarm) =>
          alarm
            .metric(
              (bucket) =>
                new Metric({
                  namespace: "AWS/S3",
                  metricName: "GetRequests",
                  dimensionsMap: {
                    BucketName: bucket.bucketName,
                    FilterId: "EntireBucket",
                  },
                  period: Duration.minutes(5),
                }),
            )
            .threshold(100)
            .lessThan()
            .description("Bucket traffic has dropped below expected level"),
        );
    });

    expect(result.alarms["serverErrors:EntireBucket"]).toBeDefined();
    expect(result.alarms["clientErrors:EntireBucket"]).toBeDefined();
    expect(result.alarms.totalRequests).toBeDefined();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  it("throws on duplicate key with recommended alarm", () => {
    expect(() =>
      buildAndSynth((b) => {
        b.serverAccessLogs(false)
          .metrics([{ id: "EntireBucket" }])
          .addAlarm("serverErrors:EntireBucket", (alarm) =>
            alarm
              .metric(
                (bucket) =>
                  new Metric({
                    namespace: "AWS/S3",
                    metricName: "5xxErrors",
                    dimensionsMap: {
                      BucketName: bucket.bucketName,
                      FilterId: "EntireBucket",
                    },
                    period: Duration.minutes(5),
                  }),
              )
              .description("Duplicate"),
          );
      }),
    ).toThrow(/Duplicate alarm key "serverErrors:EntireBucket"/);
  });

  // Regression: disabling the recommended alarms must not drop custom alarms
  // added via addAlarm() — see issue #305.
  it("keeps a custom alarm when recommendedAlarms is false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms(false).metrics([{ id: "EntireBucket" }]));
    });

    expect(result.alarms.totalRequests).toBeDefined();
    expect(Object.keys(result.alarms)).toEqual(["totalRequests"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms({ enabled: false }).metrics([{ id: "EntireBucket" }]));
    });

    expect(result.alarms.totalRequests).toBeDefined();
    expect(Object.keys(result.alarms)).toEqual(["totalRequests"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });
});

describe("resolveBucketAlarmDefinitions", () => {
  it("returns no definitions when explicitly disabled", () => {
    const stack = newStack();
    const bucket = new Bucket(stack, "Bucket");

    expect(
      resolveBucketAlarmDefinitions(bucket, { enabled: false }, [{ id: "EntireBucket" }]),
    ).toEqual([]);
  });
});

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const s3Metric = (metricName: string) => (bucket: { bucketName: string }) =>
      new Metric({
        namespace: "AWS/S3",
        metricName,
        dimensionsMap: { BucketName: bucket.bucketName, FilterId: "EntireBucket" },
        period: Duration.minutes(5),
      });
    const { result, template } = buildAndSynth((b) => {
      b.recommendedAlarms(false)
        .serverAccessLogs(false)
        .addAlarms({
          getRequests: (alarm) => alarm.metric(s3Metric("GetRequests")).threshold(100).lessThan(),
          putRequests: (alarm) => alarm.metric(s3Metric("PutRequests")).threshold(100).lessThan(),
        });
    });

    expect(Object.keys(result.alarms)).toEqual(["getRequests", "putRequests"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth(withAlarms);
    const typed: BucketBuilderResult = result;
    const serverErrors = typed.alarms["serverErrors:EntireBucket"];

    assertAssignable<Alarm | undefined, typeof serverErrors>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof serverErrors>();
    expect(serverErrors).toBeDefined();
    // @ts-expect-error -- "serverError" is not an S3 alarm name
    expect(typed.alarms["serverError:EntireBucket"]).toBeUndefined();
    // @ts-expect-error -- a recommended key names its metrics configuration
    expect(typed.alarms.clientErrors).toBeUndefined();
  });

  it("resolves a declared custom key through a typed ref, and rejects an undeclared one", () => {
    const stack = newStack();
    const system = compose(
      {
        bucket: customAlarm(createBucketBuilder()),
        consumer: {
          build: (_scope: unknown, _id: string, context: Record<string, object>) => ({
            alarm: ref("bucket", (r: WithCustomAlarms<BucketBuilderResult, "totalRequests">) => {
              // @ts-expect-error -- "totalRequest" was not declared as a custom key
              expect(r.alarms.totalRequest).toBeUndefined();
              return r.alarms.totalRequests;
            }).resolve(context),
          }),
        },
      },
      { bucket: [], consumer: ["bucket"] },
    );

    const built = system.build(stack, "System");
    assertAssignable<Alarm, typeof built.consumer.alarm>();
    expect(built.consumer.alarm).toBe(built.bucket.alarms.totalRequests);
  });
});
