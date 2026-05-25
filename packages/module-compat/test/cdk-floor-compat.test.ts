import { describe, it, expect } from "vitest";
import { App, Duration, Stack } from "aws-cdk-lib";
import {
  Alarm,
  CfnAlarm,
  CfnCompositeAlarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Template } from "aws-cdk-lib/assertions";
import { alarmActionsPolicy, alarmNamePolicy } from "@composurecdk/cloudwatch";

/**
 * `CfnAlarm.isCfnAlarm` / `CfnCompositeAlarm.isCfnCompositeAlarm` only exist in
 * aws-cdk-lib >= ~2.250. Deleting them reproduces the runtime surface of every
 * older version inside @composurecdk/cloudwatch's `^2.0.0` peer range, so `fn`
 * runs as it would on the supported floor (issue #146). Restored afterwards.
 *
 * CI installs only the latest aws-cdk-lib, so without this the floor is never
 * exercised — exactly how the #146 regression shipped undetected.
 */
function onCdkFloor(fn: () => void): void {
  const alarm = CfnAlarm as { isCfnAlarm?: unknown };
  const composite = CfnCompositeAlarm as { isCfnCompositeAlarm?: unknown };
  const savedAlarm = alarm.isCfnAlarm;
  const savedComposite = composite.isCfnCompositeAlarm;
  delete alarm.isCfnAlarm;
  delete composite.isCfnCompositeAlarm;
  try {
    fn();
  } finally {
    alarm.isCfnAlarm = savedAlarm;
    composite.isCfnCompositeAlarm = savedComposite;
  }
}

/**
 * Consumption test: drives the *built* `@composurecdk/cloudwatch` package
 * through a real `Template.fromStack` synth, so it also catches build/export
 * regressions the package's own src-level unit tests would miss.
 */
describe("@composurecdk/cloudwatch on the aws-cdk-lib floor (#146)", () => {
  it("alarm policies apply when the isCfn* L1 statics are absent", () => {
    onCdkFloor(() => {
      const app = new App();
      const stack = new Stack(app, "TestStack");
      const topic = new Topic(stack, "Topic");
      new Alarm(stack, "Errors", {
        alarmName: "Errors",
        metric: new Metric({ namespace: "Test", metricName: "Count", period: Duration.minutes(1) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });

      alarmNamePolicy(app, { defaults: { prefix: "prod" } });
      alarmActionsPolicy(app, { defaults: { alarmActions: [new SnsAction(topic)] } });

      // Both aspects run during synth; on the floor the unfixed package threw
      // "TypeError: CfnAlarm.isCfnAlarm is not a function" right here.
      const alarms = Object.values(
        Template.fromStack(stack).findResources("AWS::CloudWatch::Alarm"),
      );
      expect(alarms).toHaveLength(1);
      const props = (alarms[0] as { Properties: { AlarmName?: string; AlarmActions?: unknown[] } })
        .Properties;
      expect(props.AlarmName).toBe("prod-Errors");
      expect(props.AlarmActions).toHaveLength(1);
    });
  });
});
