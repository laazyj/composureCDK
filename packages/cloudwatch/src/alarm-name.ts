import { charSets, stringConstraint, validateString } from "@composurecdk/cloudformation";

declare const alarmNameBrand: unique symbol;

/**
 * A validated CloudWatch alarm name. Construct via {@link alarmName} or
 * {@link joinAlarmName}; the brand prevents bare strings from being passed
 * where an `AlarmName` is required.
 */
export type AlarmName = string & { readonly [alarmNameBrand]: true };

/**
 * The CloudWatch AlarmName constraint. Its character set is exactly the shared
 * `charSets.ALNUM` + `charSets.AWS_NAME_PUNCT` spine with no property-specific
 * tail — a clean reuse of the catalogue fragments. See ADR-0010.
 */
const ALARM_NAME = stringConstraint({
  name: "CloudWatch AlarmName",
  charClass: `${charSets.ALNUM}${charSets.AWS_NAME_PUNCT}`,
  minLength: 1,
  maxLength: 255,
  allowed: "A-Z a-z 0-9 space and - _ . / # : ( ) + = @",
  source:
    "https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricAlarm.html",
});

/** Validates a CloudWatch alarm name against {@link ALARM_NAME}. @throws on invalid input. */
export function validateAlarmName(value: string): void {
  validateString(value, ALARM_NAME);
}

/**
 * Validates and brands a string as an {@link AlarmName}. Surrounding whitespace
 * is trimmed, then the value is used verbatim — so what the caller writes is
 * exactly what appears in CloudWatch.
 *
 * @throws If the input is empty, exceeds 255 chars, or contains characters
 * outside CloudWatch's allowed set.
 */
export function alarmName(input: string): AlarmName {
  const trimmed = input.trim();
  validateAlarmName(trimmed);
  return trimmed as AlarmName;
}

/**
 * Builds an {@link AlarmName} by kebab-casing each segment and joining with
 * `sep`. Empty segments after kebab-casing are dropped, so callers can pass
 * e.g. `Stack.of(scope).stackName` without worrying about token-resolution
 * artefacts.
 */
export function joinAlarmName(segments: readonly string[], sep = "/"): AlarmName {
  const parts = segments.map(kebab).filter((s) => s.length > 0);
  return alarmName(parts.join(sep));
}

/**
 * Lower-cases and hyphenates a string: splits camelCase / PascalCase /
 * snake_case / dotted boundaries into hyphen-separated lowercase words.
 */
export function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
