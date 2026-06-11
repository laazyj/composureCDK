import { Annotations, Token } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/**
 * Inputs to {@link resolveAlarmThresholdBasis}.
 *
 * @typeParam T - The input value's type (e.g. `Duration`, `number`).
 */
export interface AlarmThresholdBasisOptions<T> {
  /** Construct to annotate when the alarm is skipped. */
  scope: IConstruct;

  /**
   * The value the alarm threshold is derived from. May be `undefined` (the
   * input was simply not configured) or an unresolved token (e.g. threaded
   * through a `CfnParameter`).
   */
  value: T | undefined;

  /**
   * Converts a known-resolved `value` into the numeric basis for the threshold
   * (e.g. `(d) => d.toMilliseconds()`, or the identity for a raw number). Only
   * invoked once `value` is confirmed present and resolved, so it is safe to
   * call conversions that throw on tokens.
   */
  resolve: (value: T) => number;

  /**
   * Predicate deciding whether `value` is an unresolved token. Defaults to
   * {@link Token.isUnresolved}. Override for wrapper types that carry their own
   * check rather than being a token directly — notably a CDK `Duration`, whose
   * token state is exposed via `value.isUnresolved()`.
   */
  isUnresolved?: (value: T) => boolean;

  /**
   * Stable warning identifier, also the handle callers pass to
   * `Annotations.of(scope).acknowledgeWarning(...)` to suppress it. By
   * convention `@composurecdk/<package>:<slug>`.
   */
  warningId: string;

  /**
   * Human-readable name of the alarm being skipped, interpolated into the
   * warning (e.g. `"Lambda duration"`). Phrase it to read after
   * "Skipping the recommended ".
   */
  alarmLabel: string;

  /**
   * How a caller can intentionally suppress the warning, interpolated into the
   * warning's closing sentence (e.g. `"recommendedAlarms({ duration: false })"`).
   */
  suppressHint: string;
}

/**
 * Resolves the numeric basis for a derived-threshold alarm, short-circuiting
 * when the basis cannot be known at synth time.
 *
 * Recommended alarms whose threshold is a function of a configured input (a
 * percentage of a timeout, of a reserved-concurrency limit, etc.) can only be
 * rendered when that input is concrete. When the input is an unresolved token —
 * e.g. a value threaded through a `CfnParameter` — there is no number to derive
 * from at synth time, and unit-converting it would either throw or silently
 * produce a meaningless threshold. In that case this annotates `scope` with a
 * standardized, acknowledgeable warning and returns `undefined`, signalling the
 * caller to omit the alarm.
 *
 * Returns `undefined` (without warning) when `value` is `undefined`, since an
 * unconfigured input is not a skipped guardrail. The escape hatch that disables
 * the alarm entirely (e.g. `recommendedAlarms({ duration: false })`) belongs at
 * the call site, ahead of this call.
 *
 * @returns The resolved numeric basis, or `undefined` when the alarm should be
 *   omitted.
 * @see https://github.com/laazyj/composureCDK/issues/196
 */
export function resolveAlarmThresholdBasis<T>(
  opts: AlarmThresholdBasisOptions<T>,
): number | undefined {
  if (opts.value === undefined) return undefined;

  const isUnresolved = opts.isUnresolved ?? Token.isUnresolved;
  if (isUnresolved(opts.value)) {
    Annotations.of(opts.scope).addWarningV2(
      opts.warningId,
      `Skipping the recommended ${opts.alarmLabel} alarm: its threshold is derived from a ` +
        `value that is an unresolved token and cannot be resolved to a concrete threshold at ` +
        `synth time. Set a literal value, add the alarm explicitly via addAlarm() with a fixed ` +
        `threshold, or suppress this warning with ${opts.suppressHint}.`,
    );
    return undefined;
  }

  return opts.resolve(opts.value);
}
