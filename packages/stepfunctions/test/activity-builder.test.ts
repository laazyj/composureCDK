import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Key } from "aws-cdk-lib/aws-kms";
import { CustomerManagedEncryptionConfiguration } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import { buildFixture, newStack, tagsPerResource } from "@composurecdk/cdk-testing";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createActivityBuilder } from "../src/activity-builder.js";

const buildAndSynth = buildFixture(createActivityBuilder, "Review");

const RECOMMENDED = [
  ["activitiesFailed", "ActivitiesFailed"],
  ["activitiesTimedOut", "ActivitiesTimedOut"],
  ["activitiesHeartbeatTimedOut", "ActivitiesHeartbeatTimedOut"],
] as const;

describe("ActivityBuilder", () => {
  it("creates an activity with the configured name", () => {
    const { template } = buildAndSynth((b) => b.activityName("review"));

    template.hasResourceProperties("AWS::StepFunctions::Activity", { Name: "review" });
  });

  it("tags the activity, as Security Hub StepFunctions.2 requires", () => {
    const { template } = buildAndSynth((b) => b.tag("team", "orders"));

    expect(tagsPerResource(template, "AWS::StepFunctions::Activity")).toEqual([
      [{ Key: "team", Value: "orders" }],
    ]);
  });

  it("resolves a customer-managed key from a sibling", () => {
    const stack = newStack();
    compose(
      {
        key: { build: (scope: Construct, id: string) => ({ key: new Key(scope, id) }) },
        review: createActivityBuilder().encryptionConfiguration(
          ref<{ key: Key }>("key")
            .get("key")
            .map((key) => new CustomerManagedEncryptionConfiguration(key)),
        ),
      },
      { key: [], review: ["key"] },
    ).build(stack, "System");

    Template.fromStack(stack).hasResourceProperties("AWS::StepFunctions::Activity", {
      EncryptionConfiguration: Match.objectLike({ Type: "CUSTOMER_MANAGED_KMS_KEY" }),
    });
  });

  describe("alarms", () => {
    it.each(RECOMMENDED)(
      "%s alarms on the first occurrence of AWS/States %s per minute",
      (_key, metricName) => {
        const { template } = buildAndSynth();

        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          Namespace: "AWS/States",
          MetricName: metricName,
          Statistic: "Sum",
          Period: 60,
          Threshold: 0,
          ComparisonOperator: "GreaterThanThreshold",
          TreatMissingData: "notBreaching",
          Dimensions: [{ Name: "ActivityArn", Value: Match.anyValue() }],
        });
      },
    );

    it("routes its alarm config through the shared alarm mechanism", () => {
      const { result, template } = buildAndSynth((b) =>
        b
          .recommendedAlarms({
            activitiesFailed: { threshold: 3 },
            activitiesHeartbeatTimedOut: false,
          })
          .addAlarm("scheduleTime", (a) =>
            a.metric((activity) => activity.metricScheduleTime()).threshold(60_000),
          ),
      );

      expect(Object.keys(result.alarms).sort()).toEqual([
        "activitiesFailed",
        "activitiesTimedOut",
        "scheduleTime",
      ]);
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: "ActivitiesFailed",
        Threshold: 3,
      });
    });

    it("preserves custom alarms across copy()", () => {
      const scheduled = (key: string) => (b: ReturnType<typeof createActivityBuilder>) =>
        b.addAlarm(key, (a) => a.metric((activity) => activity.metricScheduled()).threshold(0));
      assertCopyPreservesState({
        factory: () => createActivityBuilder().recommendedAlarms(false),
        configure: scheduled("first"),
        mutate: scheduled("second"),
        build: (b) => b.build(newStack(), "Review"),
        inspect: (r) => Object.keys(r.alarms).sort(),
      });
    });
  });
});
