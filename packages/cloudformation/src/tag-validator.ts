/**
 * AWS allows letters, digits, whitespace, and the symbols `_ . : / = + - @`
 * in tag keys and values, with non-ASCII letters/digits permitted via
 * Unicode classes. Empty values are permitted by AWS for `Value`, but
 * empty `Key` is not. The character set is validated against this regex.
 *
 * `\p{Z}` matches the full Unicode separator class — slightly more
 * permissive than AWS's documented "white space," but errors on the side
 * of accepting input that the AWS API may yet reject at deploy time. The
 * extra rejections happen later but are reported in the API response.
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/aws_tagging.html
 */
const TAG_CHAR_RE = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$/u;

const KEY_MAX = 128;
const VALUE_MAX = 256;

/**
 * Validates a single tag key/value pair against AWS tag constraints.
 *
 * Throws synchronously at the call site so authors see the failure where the
 * bad value was written, not at deploy time. Validates:
 *
 * - `key` is non-empty and at most {@link KEY_MAX} characters.
 * - `key` does not start with the reserved `aws:` prefix (case-insensitive).
 * - `value` is at most {@link VALUE_MAX} characters.
 * - both `key` and `value` use only the AWS-permitted character set.
 *
 * The regex matches Unicode letters, digits, and whitespace plus the
 * documented punctuation set, so non-ASCII tags are accepted as AWS
 * supports them.
 */
export function validateTag(key: string, value: string): void {
  if (key.length === 0) {
    throw new Error("Tag key must be non-empty.");
  }
  if (key.length > KEY_MAX) {
    throw new Error(`Tag key "${key}" exceeds ${String(KEY_MAX)}-character limit.`);
  }
  if (key.toLowerCase().startsWith("aws:")) {
    throw new Error(
      `Tag key "${key}" uses reserved "aws:" prefix; AWS rejects user tags with this prefix.`,
    );
  }
  if (!TAG_CHAR_RE.test(key)) {
    throw new Error(
      `Tag key "${key}" contains characters outside the AWS tag character set ` +
        "(letters, digits, whitespace, and `_ . : / = + - @`).",
    );
  }
  if (value.length > VALUE_MAX) {
    throw new Error(`Tag value for key "${key}" exceeds ${String(VALUE_MAX)}-character limit.`);
  }
  if (!TAG_CHAR_RE.test(value)) {
    throw new Error(
      `Tag value for key "${key}" contains characters outside the AWS tag character set ` +
        "(letters, digits, whitespace, and `_ . : / = + - @`).",
    );
  }
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
