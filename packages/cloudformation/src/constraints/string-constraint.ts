/**
 * The shared mechanism behind the AWS-property constraint catalogue.
 *
 * AWS rejects malformed property strings (bad character sets, over-length
 * values) at deploy time, hours after `cdk synth`. A {@link StringConstraint}
 * captures one AWS property's character-set and length rules as data, so a
 * builder can fail at synth — at the authoring call site — instead.
 *
 * The catalogue is deliberately split: this mechanism lives here, while the
 * per-resource constraint *data* lives in the package that owns the builder
 * (e.g. `SECURITY_GROUP_DESCRIPTION` in `@composurecdk/ec2`). Cross-cutting
 * constraints that apply to every resource — tags — are the exception and
 * live alongside this mechanism. See ADR-0010.
 */

/**
 * A single AWS-property constraint, expressed as data. One entry per
 * `(resource, property)` pair.
 *
 * Both regexes are compiled once. `validate*` helpers test {@link pattern};
 * `sanitize*` helpers replace runs matched by {@link sanitizePattern}. Use
 * {@link stringConstraint} to build one so the two stay in sync.
 */
export interface StringConstraint {
  /** Human-readable property identifier, e.g. `"EC2 SecurityGroup GroupDescription"`. */
  readonly name: string;
  /** Anchored full-match pattern used by `validate*`. */
  readonly pattern: RegExp;
  /** Global negated-character-class pattern used by `sanitize*`; absent for pattern-only constraints. */
  readonly sanitizePattern?: RegExp;
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Human-readable allowed-set, surfaced in validation error messages. */
  readonly allowed: string;
  /** AWS doc / CFN reference URL, surfaced in validation error messages. */
  readonly source: string;
}

/**
 * Builds a {@link StringConstraint} from a character class and bounds. The
 * anchored validation pattern and the negated sanitisation pattern are both
 * derived from `charClass` and compiled once here, so a single declaration
 * drives both validation and sanitisation and the two cannot drift apart.
 *
 * @param spec - The constraint's character class, length bounds, and metadata.
 * @returns A constraint ready for {@link validateString} / {@link sanitizeString}.
 */
export function stringConstraint(spec: {
  name: string;
  charClass: string;
  minLength?: number;
  maxLength?: number;
  allowed: string;
  source: string;
  flags?: string;
}): StringConstraint {
  const quantifier = `{${String(spec.minLength ?? 0)},${spec.maxLength === undefined ? "" : String(spec.maxLength)}}`;
  return {
    name: spec.name,
    pattern: new RegExp(`^[${spec.charClass}]${quantifier}$`, spec.flags),
    sanitizePattern: new RegExp(`[^${spec.charClass}]+`, spec.flags?.includes("u") ? "gu" : "g"),
    minLength: spec.minLength,
    maxLength: spec.maxLength,
    allowed: spec.allowed,
    source: spec.source,
  };
}

/**
 * Validates `value` against `constraint`, throwing synchronously on the first
 * violation. Use for **user-authored** values the author can fix — the error
 * fires at the call site, naming the allowed set and linking the AWS doc.
 *
 * @throws If `value` is shorter than `minLength`, longer than `maxLength`, or
 * contains characters outside the constraint's pattern.
 */
export function validateString(value: string, constraint: StringConstraint): void {
  if (constraint.minLength !== undefined && value.length < constraint.minLength) {
    throw new Error(
      `${constraint.name} "${value}" is shorter than the ${String(constraint.minLength)}-character minimum. See ${constraint.source}.`,
    );
  }
  if (constraint.maxLength !== undefined && value.length > constraint.maxLength) {
    throw new Error(
      `${constraint.name} "${value}" exceeds the ${String(constraint.maxLength)}-character limit. See ${constraint.source}.`,
    );
  }
  if (!constraint.pattern.test(value)) {
    throw new Error(
      `${constraint.name} "${value}" is invalid. Allowed: ${constraint.allowed}. See ${constraint.source}.`,
    );
  }
}

/**
 * Returns a copy of `value` made legal for `constraint` by replacing runs of
 * disallowed characters with `replacement` and truncating to `maxLength`. Use
 * for **derived** values the author does not control (e.g. a DNS name composed
 * into a construct ID), where rewriting is the only sensible move.
 *
 * @throws If the constraint is pattern-only and declares no sanitisation pattern.
 */
export function sanitizeString(
  value: string,
  constraint: StringConstraint,
  replacement = "-",
): string {
  if (constraint.sanitizePattern === undefined) {
    throw new Error(
      `${constraint.name} cannot be sanitised: the constraint has no character class.`,
    );
  }
  let out = value.replace(constraint.sanitizePattern, replacement);
  if (constraint.maxLength !== undefined && out.length > constraint.maxLength) {
    out = out.slice(0, constraint.maxLength);
  }
  return out;
}
