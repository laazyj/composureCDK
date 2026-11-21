import type { Alarm } from "aws-cdk-lib/aws-cloudwatch";

/**
 * The type of a builder result's `alarms`, keyed by the builder's
 * recommended alarms, so that a misspelled key is a compile error rather
 * than an `undefined` at synth.
 *
 * Each key is **optional**: a recommended alarm can be turned off by the
 * user, gated on configuration (a timeout, an attached event source), or
 * skipped by {@link resolveAlarmThresholdBasis} when its basis is an
 * unresolved token. Template-literal keys work as patterns:
 * `` `${string}DroppedEvents` `` accepts any key with that suffix and still
 * rejects a misspelled one.
 *
 * Custom alarms are added with {@link WithCustomAlarms}.
 */
export type AlarmsOf<Recommended extends string> = Partial<Record<Recommended, Alarm>>;

/**
 * A builder result whose `alarms` also holds the custom alarms named in
 * `Custom`, each typed `Alarm`: `addAlarm(key, …)` always creates its alarm.
 *
 * Name the custom keys where they are read, e.g.
 * `(r: WithCustomAlarms<QueueBuilderResult, "backlogDepth">) => r.alarms.backlogDepth`.
 * A builder's own `build()` returns `WithCustomAlarms<Result, string>`. See
 * ADR-0021.
 */
export type WithCustomAlarms<Result extends { alarms: object }, Custom extends string> = Result & {
  alarms: Record<Custom, Alarm>;
};
