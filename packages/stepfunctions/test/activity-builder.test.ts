import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";
import { Key } from "aws-cdk-lib/aws-kms";
import { CustomerManagedEncryptionConfiguration } from "aws-cdk-lib/aws-stepfunctions";
import type { Construct } from "constructs";
import {
  assertAssignable,
  buildFixture,
  newStack,
  tagsPerResource,
} from "@composurecdk/cdk-testing";
import type { WithCustomAlarms } from "@composurecdk/cloudwatch";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { type ActivityBuilderResult, createActivityBuilder } from "../src/activity-builder.js";

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

describe("addAlarms", () => {
  it("adds each entry as a custom alarm under its key", () => {
    const { result, template } = buildAndSynth((b) =>
      b.recommendedAlarms(false).addAlarms({
        scheduled: (a) => a.metric((activity) => activity.metricScheduled()).threshold(0),
        scheduleTime: (a) =>
          a.metric((activity) => activity.metricScheduleTime()).threshold(60_000),
      }),
    );

    expect(Object.keys(result.alarms)).toEqual(["scheduled", "scheduleTime"]);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

// The `@ts-expect-error` lines are the assertions: tsc (the `typecheck`
// target, run before `test`) fails if any of them stops being an error.
describe("alarm keys (type-level)", () => {
  it("types recommended alarms as optional and rejects a misspelled key", () => {
    const { result } = buildAndSynth();
    const typed: ActivityBuilderResult = result;
    const failed = typed.alarms.activitiesFailed;

    assertAssignable<Alarm | undefined, typeof failed>();
    // @ts-expect-error -- a recommended alarm may be disabled, so it is not always an Alarm
    assertAssignable<Alarm, typeof failed>();
    expect(failed).toBeDefined();
    // @ts-expect-error -- "activityFailed" is not an activity alarm key
    expect(typed.alarms.activityFailed).toBeUndefined();
  });

  it("types a declared custom key as present, and rejects an undeclared one", () => {
    const { result } = buildAndSynth((b) =>
      b.addAlarm("scheduled", (a) =>
        a.metric((activity) => activity.metricScheduled()).threshold(0),
      ),
    );
    const alarm = ref("review", (r: WithCustomAlarms<ActivityBuilderResult, "scheduled">) => {
      // @ts-expect-error -- "schedule" was not declared as a custom key
      expect(r.alarms.schedule).toBeUndefined();
      return r.alarms.scheduled;
    }).resolve({ review: result });

    assertAssignable<Alarm, typeof alarm>();
    expect(alarm).toBe(result.alarms.scheduled);
  });
});
