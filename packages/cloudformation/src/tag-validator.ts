import { stringConstraint, validateString } from "./constraints/index.js";

/**
 * AWS allows letters, digits, whitespace, and the symbols `_ . : / = + - @`
 * in tag keys and values, with non-ASCII letters/digits permitted via
 * Unicode classes.
 *
 * `\p{Z}` matches the full Unicode separator class — slightly more permissive
 * than AWS's documented "white space," but errs on the side of accepting input
 * the AWS API may yet reject at deploy time, where the failure is reported in
 * the API response.
 */
const TAG_CHARS = "\\p{L}\\p{Z}\\p{N}_.:/=+@\\-";
const TAG_ALLOWED = "the AWS tag character set: letters, digits, whitespace, and _ . : / = + - @";
const TAG_SOURCE = "https://docs.aws.amazon.com/general/latest/gr/aws_tagging.html";

/**
 * Tags are cross-cutting — they apply to every resource — so unlike per-resource
 * constraints they live alongside the catalogue mechanism rather than in a
 * service package. Both entries ride {@link validateString}; the empty-key and
 * reserved-prefix rules below are tag-specific and stay bespoke. See ADR-0010.
 */
const TAG_KEY = stringConstraint({
  name: "Tag key",
  charClass: TAG_CHARS,
  maxLength: 128,
  allowed: TAG_ALLOWED,
  source: TAG_SOURCE,
  flags: "u",
});

const TAG_VALUE = stringConstraint({
  name: "Tag value",
  charClass: TAG_CHARS,
  maxLength: 256,
  allowed: TAG_ALLOWED,
  source: TAG_SOURCE,
  flags: "u",
});

// Exported as public catalogue entries — symmetric with per-resource
// constraints like SECURITY_GROUP_DESCRIPTION. They let callers validate tag
// strings directly (`validateString(key, TAG_KEY)`) and make tags appear in
// the generated catalogue (ADR-0010). The `validate*` entry point stays
// `validateTag`, which layers the empty-key and reserved-prefix rules on top.
export { TAG_KEY, TAG_VALUE };

/**
 * Validates a single tag key/value pair against AWS tag constraints.
 *
 * Throws synchronously at the call site so authors see the failure where the
 * bad value was written, not at deploy time. Validates:
 *
 * - `key` is non-empty and does not start with the reserved `aws:` prefix
 *   (case-insensitive) — both tag-specific rules.
 * - `key` and `value` length and character set, via the shared catalogue
 *   mechanism. Empty values are permitted; empty keys are not.
 *
 * Non-ASCII letters, digits, and whitespace are accepted, matching AWS.
 */
export function validateTag(key: string, value: string): void {
  if (key.length === 0) {
    throw new Error("Tag key must be non-empty.");
  }
  if (key.toLowerCase().startsWith("aws:")) {
    throw new Error(
      `Tag key "${key}" uses reserved "aws:" prefix; AWS rejects user tags with this prefix.`,
    );
  }
  validateString(key, TAG_KEY);
  validateString(value, TAG_VALUE);
}

/**
 * Validates every entry of a record via {@link validateTag}, throwing on the
 * first invalid pair so the failure surfaces at the configuring call site.
 */
export function validateTagRecord(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    validateTag(key, value);
  }
}
