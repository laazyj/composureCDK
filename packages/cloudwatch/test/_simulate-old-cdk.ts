import { CfnAlarm, CfnCompositeAlarm } from "aws-cdk-lib/aws-cloudwatch";

/**
 * Runs `fn` with `CfnAlarm.isCfnAlarm` / `CfnCompositeAlarm.isCfnCompositeAlarm`
 * removed, reproducing aws-cdk-lib < 2.250 where those statics don't exist
 * (issue #146). Restores them afterwards so other tests are unaffected.
 *
 * Not a `*.test.ts` file, so vitest does not collect it as a suite.
 */
export function withoutIsCfnStatics(fn: () => void): void {
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
