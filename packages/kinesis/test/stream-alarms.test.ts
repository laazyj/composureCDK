import { describe, it, expect } from "vitest";
import { App, CfnParameter, Duration, Stack } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Stream } from "aws-cdk-lib/aws-kinesis";
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { createStreamBuilder } from "../src/stream-builder.js";
import { resolveStreamAlarmDefinitions } from "../src/stream-alarms.js";
import { STREAM_ALARM_DEFAULTS } from "../src/stream-alarm-defaults.js";

const buildAndSynth = buildFixture(createStreamBuilder, "TestStream");

/** 50% of the default 168-hour retention, in milliseconds. */
const DEFAULT_ITERATOR_AGE_THRESHOLD = 302_400_000;

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates the five on-by-default alarms", () => {
      const { result, template } = buildAndSynth();

      expect(Object.keys(result.alarms).sort()).toEqual([
        "getRecordsIteratorAgeMilliseconds",
        "getRecordsSuccess",
        "putRecordSuccess",
        "readProvisionedThroughputExceeded",
        "writeProvisionedThroughputExceeded",
      ]);
      template.resourceCountIs("AWS::CloudWatch::Alarm", 5);
    });

    it.each([
      {
        metricName: "GetRecords.IteratorAgeMilliseconds",
        statistic: "Maximum",
        threshold: DEFAULT_ITERATOR_AGE_THRESHOLD,
        operator: "GreaterThanThreshold",
        periods: 15,
      },
      {
        metricName: "ReadProvisionedThroughputExceeded",
        statistic: "Average",
        threshold: 0.01,
        operator: "GreaterThanThreshold",
        periods: 5,
      },
      {
        metricName: "WriteProvisionedThroughputExceeded",
        statistic: "Average",
        threshold: 0.01,
        operator: "GreaterThanThreshold",
        periods: 5,
      },
      {
        metricName: "PutRecord.Success",
        statistic: "Average",
        threshold: 0.99,
        operator: "LessThanThreshold",
        periods: 5,
      },
      {
        metricName: "GetRecords.Success",
        statistic: "Average",
        threshold: 0.99,
        operator: "LessThanThreshold",
        periods: 5,
      },
    ])(
      "creates the $metricName alarm ($statistic, $operator $threshold, $periods of $periods)",
      ({ metricName, statistic, threshold, operator, periods }) => {
        const { template } = buildAndSynth();

        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          MetricName: metricName,
          Namespace: "AWS/Kinesis",
          Statistic: statistic,
          Period: 60,
          Threshold: threshold,
          ComparisonOperator: operator,
          EvaluationPeriods: periods,
          DatapointsToAlarm: periods,
          TreatMissingData: "notBreaching",
          Dimensions: [{ Name: "StreamName", Value: Match.anyValue() }],
          AlarmActions: Match.absent(),
        });
      },
    );

    it("does not create the putRecordsFailedRecords alarm", () => {
      const { result } = buildAndSynth();

      expect(result.alarms.putRecordsFailedRecords).toBeUndefined();
    });

    it("keeps STREAM_ALARM_DEFAULTS' iterator-age baseline in step with the default retention", () => {
      expect(STREAM_ALARM_DEFAULTS.getRecordsIteratorAgeMilliseconds.threshold).toBe(
        DEFAULT_ITERATOR_AGE_THRESHOLD,
      );
    });
  });

  describe("iterator-age threshold", () => {
    it("derives the threshold from a custom retention period", () => {
      const { template } = buildAndSynth((b) => b.retentionPeriod(Duration.hours(24)));

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "GetRecords.IteratorAgeMilliseconds",
        Threshold: 43_200_000,
      });
    });

    it("states the threshold and its basis in the description", () => {
      const { template } = buildAndSynth();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "GetRecords.IteratorAgeMilliseconds",
        AlarmDescription: Match.stringLikeRegexp(
          "Threshold: > 302400000 ms \\(50% of the stream's 604800000 ms retention period\\), " +
            "for 15 of 15 1-minute periods\\.",
        ),
      });
    });

    it("prefers a user-supplied threshold over the derived one", () => {
      const { template } = buildAndSynth((b) =>
        b
          .retentionPeriod(Duration.hours(24))
          .recommendedAlarms({ getRecordsIteratorAgeMilliseconds: { threshold: 60_000 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "GetRecords.IteratorAgeMilliseconds",
        Threshold: 60_000,
        EvaluationPeriods: 15,
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 60000 ms, for 15 of 15"),
      });
    });

    describe("with a token retention period", () => {
      function buildWithTokenRetention(
        configure?: (b: ReturnType<typeof createStreamBuilder>) => void,
      ) {
        const stack = new Stack(new App(), "TestStack");
        const retentionHours = new CfnParameter(stack, "RetentionHours", {
          type: "Number",
          default: 168,
        });
        const builder = createStreamBuilder().retentionPeriod(
          Duration.hours(retentionHours.valueAsNumber),
        );
        configure?.(builder);
        return { stack, result: builder.build(stack, "TestStream") };
      }

      it("skips the iterator-age alarm with a warning", () => {
        const { stack, result } = buildWithTokenRetention();

        expect(result.alarms.getRecordsIteratorAgeMilliseconds).toBeUndefined();
        expect(result.alarms.getRecordsSuccess).toBeDefined();
        Annotations.fromStack(stack).hasWarning(
          "/TestStack/TestStream",
          Match.stringLikeRegexp(
            "Skipping the recommended Kinesis GetRecords iterator-age alarm.*" +
              "\\[ack: @composurecdk/kinesis:iterator-age-alarm-token-retention\\]",
          ),
        );
      });

      it("creates the alarm without a warning when a threshold is supplied", () => {
        const { stack, result } = buildWithTokenRetention((b) =>
          b.recommendedAlarms({ getRecordsIteratorAgeMilliseconds: { threshold: 60_000 } }),
        );

        expect(result.alarms.getRecordsIteratorAgeMilliseconds).toBeDefined();
        Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
      });

      it("does not warn when the alarm is disabled", () => {
        const { stack } = buildWithTokenRetention((b) =>
          b.recommendedAlarms({ getRecordsIteratorAgeMilliseconds: false }),
        );

        Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
      });
    });
  });

  describe("customisation", () => {
    it("allows overriding a threshold", () => {
      const { template } = buildAndSynth((b) =>
        b.recommendedAlarms({ putRecordSuccess: { threshold: 0.95 } }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "PutRecord.Success",
        Threshold: 0.95,
        ComparisonOperator: "LessThanThreshold",
      });
    });

    it("allows overriding evaluationPeriods, datapointsToAlarm and treatMissingData", () => {
      const { template } = buildAndSynth((b) =>
        b.recommendedAlarms({
          writeProvisionedThroughputExceeded: {
            evaluationPeriods: 10,
            datapointsToAlarm: 3,
            treatMissingData: TreatMissingData.MISSING,
          },
        }),
      );

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "WriteProvisionedThroughputExceeded",
        Threshold: 0.01,
        EvaluationPeriods: 10,
        DatapointsToAlarm: 3,
        TreatMissingData: "missing",
      });
    });

    it("disables an individual alarm when set to false", () => {
      const { result, template } = buildAndSynth((b) =>
        b.recommendedAlarms({ readProvisionedThroughputExceeded: false }),
      );

      expect(result.alarms.readProvisionedThroughputExceeded).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    });

    it("disables all recommended alarms when recommendedAlarms is false", () => {
      const { result, template } = buildAndSynth((b) => b.recommendedAlarms(false));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all recommended alarms when enabled is false", () => {
      const { result, template } = buildAndSynth((b) => b.recommendedAlarms({ enabled: false }));

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("creates putRecordsFailedRecords when opted in with a threshold", () => {
      const { result, template } = buildAndSynth((b) =>
        b.recommendedAlarms({ putRecordsFailedRecords: { threshold: 100 } }),
      );

      expect(result.alarms.putRecordsFailedRecords).toBeDefined();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "PutRecords.FailedRecords",
        Namespace: "AWS/Kinesis",
        Statistic: "Sum",
        Period: 60,
        Threshold: 100,
        ComparisonOperator: "GreaterThanThreshold",
        EvaluationPeriods: 5,
        DatapointsToAlarm: 5,
        TreatMissingData: "notBreaching",
        AlarmDescription: Match.stringLikeRegexp("Threshold: > 100 records, for 5 of 5"),
      });
    });

    it("throws when putRecordsFailedRecords is opted in without a threshold", () => {
      // No generic failed-records threshold fits every workload, so the opt-in
      // must bring its own instead of silently inheriting a noisy 0.
      expect(() =>
        buildAndSynth((b) => b.recommendedAlarms({ putRecordsFailedRecords: {} })),
      ).toThrow(/"putRecordsFailedRecords" alarm has no generic default threshold/);
    });
  });
});

describe("addAlarm duplicate-key safety", () => {
  it("throws when a custom alarm reuses a recommended-alarm key", () => {
    expect(() =>
      buildAndSynth((b) => {
        b.addAlarm("putRecordSuccess", (alarm) =>
          alarm
            .metric((stream) => stream.metricPutRecordSuccess())
            .threshold(1)
            .lessThan()
            .description("Duplicate"),
        );
      }),
    ).toThrow(/Duplicate alarm key "putRecordSuccess"/);
  });
});

describe("custom alarms survive disabled recommended alarms", () => {
  function customAlarm(builder: ReturnType<typeof createStreamBuilder>) {
    return builder.addAlarm("noIncomingRecords", (alarm) =>
      alarm
        .metric((stream) => stream.metricIncomingRecords())
        .threshold(1)
        .lessThan()
        .description("No records arriving."),
    );
  }

  it("keeps a custom alarm when recommendedAlarms is false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms(false));
    });

    expect(Object.keys(result.alarms)).toEqual(["noIncomingRecords"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("keeps a custom alarm when recommendedAlarms is disabled via enabled:false", () => {
    const { result, template } = buildAndSynth((b) => {
      customAlarm(b.recommendedAlarms({ enabled: false }));
    });

    expect(Object.keys(result.alarms)).toEqual(["noIncomingRecords"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
  });

  it("creates custom alarms alongside the recommended set", () => {
    const { result } = buildAndSynth((b) => {
      customAlarm(b);
    });

    expect(result.alarms.noIncomingRecords).toBeDefined();
    expect(Object.keys(result.alarms)).toHaveLength(6);
  });
});

describe("resolveStreamAlarmDefinitions", () => {
  it("returns no definitions when explicitly disabled", () => {
    const stack = newStack();
    const stream = new Stream(stack, "Stream");

    expect(resolveStreamAlarmDefinitions(stream, { enabled: false }, Duration.hours(24))).toEqual(
      [],
    );
  });
});
