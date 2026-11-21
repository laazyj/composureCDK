import type { IAlarm } from "aws-cdk-lib/aws-cloudwatch";

type Present<T> = { [K in keyof T]-?: NonNullable<T[K]> };

/**
 * Narrows a record of alarms that may be absent to one where every alarm is
 * present, and throws, naming the key, for any that is `undefined`.
 *
 * A recommended alarm is typed `Alarm | undefined`, because it can be
 * disabled or depend on configuration (see {@link AlarmsOf}). Where an alarm
 * must exist, such as a member of a rollback composite alarm, a missing one
 * is a defect: this makes it fail at synth with the key, rather than
 * silently drop out of the rule.
 *
 * @throws If any value in `alarms` is `undefined`.
 */
export function requireAlarms<T extends Record<string, IAlarm | undefined>>(alarms: T): Present<T> {
  const missing = Object.keys(alarms).filter((key) => alarms[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `requireAlarms: ${missing.map((key) => `"${key}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} not present. ` +
        "A recommended alarm is absent when it is disabled, or when the resource lacks the configuration it needs; enable it, or leave it out.",
    );
  }
  return alarms as Present<T>;
}
