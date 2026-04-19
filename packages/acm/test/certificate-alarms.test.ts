import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { createCertificateBuilder } from "../src/certificate-builder.js";

function buildResult(configureFn?: (builder: ReturnType<typeof createCertificateBuilder>) => void) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
  const builder = createCertificateBuilder().domainName("example.com").validationZone(zone);
  configureFn?.(builder);
  const result = builder.build(stack, "TestCertificate");
  return { result, template: Template.fromStack(stack) };
}

describe("recommended alarms", () => {
  describe("defaults", () => {
    it("creates the daysToExpiry alarm by default", () => {
      const { result, template } = buildResult();

      expect(result.alarms.daysToExpiry).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    });

    it("creates daysToExpiry with AWS-recommended 45-day threshold", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        Namespace: "AWS/CertificateManager",
        Threshold: 45,
        ComparisonOperator: "LessThanOrEqualToThreshold",
        EvaluationPeriods: 1,
        DatapointsToAlarm: 1,
        TreatMissingData: "notBreaching",
        Statistic: "Minimum",
        Period: 86400,
        Dimensions: Match.arrayWith([Match.objectLike({ Name: "CertificateArn" })]),
      });
    });

    it("includes threshold justification in the alarm description", () => {
      const { template } = buildResult();

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        AlarmDescription: Match.stringLikeRegexp("45"),
      });
    });
  });

  describe("customisation", () => {
    it("honours a custom threshold", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ daysToExpiry: { threshold: 30 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        Threshold: 30,
      });
    });

    it("preserves unspecified fields when threshold is overridden", () => {
      const { template } = buildResult((b) => {
        b.recommendedAlarms({ daysToExpiry: { threshold: 30 } });
      });

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        EvaluationPeriods: 1,
        TreatMissingData: "notBreaching",
      });
    });

    it("disables the daysToExpiry alarm when set to false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ daysToExpiry: false });
      });

      expect(result.alarms.daysToExpiry).toBeUndefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when recommendedAlarms is false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms(false);
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });

    it("disables all alarms when enabled is false", () => {
      const { result, template } = buildResult((b) => {
        b.recommendedAlarms({ enabled: false });
      });

      expect(result.alarms).toEqual({});
      template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    });
  });

  describe("custom alarms", () => {
    it("creates a custom alarm alongside the recommended alarms", () => {
      const { result, template } = buildResult((b) => {
        b.addAlarm("custom", (alarm) =>
          alarm
            .metric(
              (cert: ICertificate) =>
                new Metric({
                  namespace: "AWS/CertificateManager",
                  metricName: "DaysToExpiry",
                  dimensionsMap: { CertificateArn: cert.certificateArn },
                  statistic: "Minimum",
                  period: Duration.days(1),
                }),
            )
            .threshold(10)
            .lessThanOrEqual()
            .description("Certificate very close to expiry"),
        );
      });

      expect(result.alarms.custom).toBeDefined();
      expect(result.alarms.daysToExpiry).toBeDefined();
      template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    });

    it("rejects a custom alarm that collides with a recommended alarm key", () => {
      expect(() =>
        buildResult((b) => {
          b.addAlarm("daysToExpiry", (alarm) =>
            alarm
              .metric(
                (cert: ICertificate) =>
                  new Metric({
                    namespace: "AWS/CertificateManager",
                    metricName: "DaysToExpiry",
                    dimensionsMap: { CertificateArn: cert.certificateArn },
                    statistic: "Minimum",
                    period: Duration.days(1),
                  }),
              )
              .threshold(10)
              .lessThanOrEqual(),
          );
        }),
      ).toThrow(/Duplicate alarm key/);
    });
  });

  describe("treatMissingData semantics", () => {
    it("uses NOT_BREACHING by default so expired certs do not stay alarmed", () => {
      const { template } = buildResult();
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "DaysToExpiry",
        TreatMissingData: "notBreaching",
      });

      // Sanity: the public enum value we rely on resolves to 'notBreaching'.
      expect(TreatMissingData.NOT_BREACHING).toBe("notBreaching");
    });
  });
});
