/**
 * Utilities for producing safe CDK construct IDs from arbitrary strings.
 *
 * The `constructs` library uses `/` as the path separator between construct
 * IDs. When user-supplied strings (DNS names, ARNs, filesystem paths) are
 * passed through to a construct ID, any embedded `/` silently gets rewritten
 * to `--`, which produces unreadable CloudFormation logical IDs. Control
 * characters are likewise unsafe.
 *
 * These helpers consolidate that sanitization in one place so every builder
 * in the monorepo applies the same constraints.
 */

// eslint-disable-next-line no-control-regex -- the regex must literally match control characters to strip them from construct IDs
const UNSAFE = /[/\x00-\x1f\x7f]/g;

/**
 * Characters that are never legitimate in a construct ID. Braces and brackets
 * signal a leaked CDK token — a string token always encodes as
 * `${Token[TOKEN.n]}`, which contains all four — but no valid DNS name, ARN, or
 * path contains them either, so rejecting them is safe for real inputs.
 *
 * `$` is deliberately excluded: on its own it is borderline (it can appear in
 * odd-but-legal names), and the brace/bracket set already catches the token
 * encoding.
 */
const REJECTED = /[{}[\]]/;

/**
 * Return a construct-ID-safe copy of `raw` by replacing unsafe characters
 * (`/` and control characters) with a single `-`.
 *
 * Does not touch other characters — CDK construct IDs are otherwise
 * permissive, and collapsing further (e.g., to PascalCase) would destroy
 * information a reader expects to see in the synthesised tree.
 *
 * Throws on `{`, `}`, `[`, or `]`. These never appear in a well-formed ID; in
 * practice they mean an unresolved CDK token (`${Token[TOKEN.n]}`) has leaked
 * into an ID, which yields an unstable logical ID whose hash churns with the
 * token counter. Failing here surfaces the mistake at its source rather than
 * silently stripping it to a stable-looking but still-broken ID. Core stays
 * `aws-cdk-lib`-free, so this is a character check, not a `Token.isUnresolved`
 * check — callers that need token-aware handling must guard before calling.
 *
 * @example
 * ```ts
 * sanitizeConstructId("a/b")       // "a-b"
 * sanitizeConstructId("_sip._tcp") // "_sip._tcp" (unchanged)
 * sanitizeConstructId("${Token[TOKEN.7]}") // throws
 * ```
 */
export function sanitizeConstructId(raw: string): string {
  if (REJECTED.test(raw)) {
    throw new Error(
      `Invalid construct ID ${JSON.stringify(raw)}: ` +
        `the characters { } [ ] are not allowed. ` +
        `This usually means an unresolved CDK token has leaked into a construct ID — ` +
        `supply a stable, static ID instead.`,
    );
  }
  return raw.replace(UNSAFE, "-");
}

/**
 * Join the supplied parts into a single construct ID. Falsy parts are
 * dropped; each remaining part is passed through {@link sanitizeConstructId}
 * and the results are joined with `-`.
 *
 * Intended for composing IDs from a mix of static prefixes and user-supplied
 * fragments — the sanitization step means callers don't have to reason about
 * most characters their inputs might contain. Throws if any part contains
 * `{ } [ ]` (see {@link sanitizeConstructId}), which signals a leaked CDK
 * token.
 *
 * @example
 * ```ts
 * constructId("records", "a", "api")   // "records-a-api"
 * constructId("zone", undefined, "www") // "zone-www"
 * constructId("records", "a/b")         // "records-a-b"
 * ```
 */
export function constructId(...parts: readonly (string | undefined | null | false)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map(sanitizeConstructId)
    .join("-");
}
