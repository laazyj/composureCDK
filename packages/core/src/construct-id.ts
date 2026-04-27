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

// eslint-disable-next-line no-control-regex
const UNSAFE = /[/\x00-\x1f\x7f]/g;

/**
 * Return a construct-ID-safe copy of `raw` by replacing unsafe characters
 * (`/` and control characters) with a single `-`.
 *
 * Does not touch other characters — CDK construct IDs are otherwise
 * permissive, and collapsing further (e.g., to PascalCase) would destroy
 * information a reader expects to see in the synthesised tree.
 *
 * @example
 * ```ts
 * sanitizeConstructId("a/b")       // "a-b"
 * sanitizeConstructId("_sip._tcp") // "_sip._tcp" (unchanged)
 * ```
 */
export function sanitizeConstructId(raw: string): string {
  return raw.replace(UNSAFE, "-");
}

/**
 * Join the supplied parts into a single construct ID. Falsy parts are
 * dropped; each remaining part is passed through {@link sanitizeConstructId}
 * and the results are joined with `-`.
 *
 * Intended for composing IDs from a mix of static prefixes and user-supplied
 * fragments — the sanitization step means callers don't have to reason about
 * what characters their inputs might contain.
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
