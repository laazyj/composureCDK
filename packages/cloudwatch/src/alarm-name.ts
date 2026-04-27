declare const alarmNameBrand: unique symbol;

/**
 * A validated CloudWatch alarm name. Construct via {@link alarmName} or
 * {@link joinAlarmName}; the brand prevents bare strings from being passed
 * where an `AlarmName` is required.
 */
export type AlarmName = string & { readonly [alarmNameBrand]: true };

const VALID_CHARS = /^[A-Za-z0-9\-_./#:()+ =@]+$/;
const MAX_LEN = 255;

/**
 * Validates and brands a string as an {@link AlarmName}. The string is used
 * verbatim — no sanitisation — so what the caller writes is exactly what
 * appears in CloudWatch.
 *
 * @throws If the input is empty, exceeds 255 chars, or contains characters
 * outside CloudWatch's allowed set: `[A-Za-z0-9-_./#:()+ =@]`.
 */
export function alarmName(input: string): AlarmName {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("alarm name cannot be empty");
  }
  if (trimmed.length > MAX_LEN) {
    throw new Error(`alarm name exceeds ${String(MAX_LEN)} chars: "${trimmed}"`);
  }
  if (!VALID_CHARS.test(trimmed)) {
    throw new Error(
      `alarm name contains invalid characters (allowed: A-Z a-z 0-9 - _ . / # : ( ) + = @ space): "${trimmed}"`,
    );
  }
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
 *
 * Exported so consumers can compose names with the same convention used
 * by {@link defaultAlarmName}.
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
