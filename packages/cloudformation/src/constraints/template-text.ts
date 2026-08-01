import { Token } from "aws-cdk-lib";
import { stringConstraint } from "./string-constraint.js";

/**
 * The character set CloudFormation stores verbatim in template text.
 *
 * Printable ASCII plus the three whitespace characters a multi-line
 * description legitimately contains (tab, LF, CR). Anything else is
 * transliterated to `?` when CloudFormation stores the template, so the
 * deployed template stops matching the synthesised one.
 */
const CHAR_CLASS = "\\x09\\x0a\\x0d\\x20-\\x7e";

/**
 * Matches one disallowed character at a time. The constraint's own
 * `sanitizePattern` collapses a *run* into a single replacement, which loses
 * more than CloudFormation does — see {@link sanitizeTemplateText}. The `u`
 * flag is load-bearing: without it an astral character matches as two lone
 * surrogates and {@link describeOffenders} reports a garbage code point.
 */
const DISALLOWED = new RegExp(`[^${CHAR_CLASS}]`, "gu");

/**
 * The same class without `g`, for a cheap "is there anything to report?" test.
 * `matchAll` species-constructs a fresh RegExp and an iterator on every call,
 * which is wasted on the overwhelmingly common clean value.
 */
const HAS_DISALLOWED = new RegExp(`[^${CHAR_CLASS}]`, "u");

const TEMPLATE_TEXT = stringConstraint({
  name: "CloudFormation template text",
  charClass: CHAR_CLASS,
  allowed: "ASCII text - printable characters, tab and newline",
  source:
    "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-anatomy.html#template-description-structure",
  // Keeps the catalogue's derived patterns matching by code point, as
  // `DISALLOWED` does, so `validateString(v, TEMPLATE_TEXT)` and this module
  // cannot disagree about the same declared character class.
  flags: "u",
});

/**
 * ASCII stand-ins for common typographic characters. Keys are written as
 * `\\u` escapes so an invisible character — the five space variants especially
 * — cannot hide in this table, or be duplicated in it unnoticed.
 *
 * Anything not listed falls back to `?`, which is what CloudFormation itself
 * would have stored: the sanitised template matches the deployed one either
 * way, and an unmapped character stays visible instead of quietly becoming a
 * plausible-looking hyphen.
 */
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  "\u2010": "-", // hyphen
  "\u2011": "-", // non-breaking hyphen
  "\u2012": "-", // figure dash
  "\u2013": "-", // en dash
  "\u2014": "-", // em dash
  "\u2015": "-", // horizontal bar
  "\u2018": "'", // left single quote
  "\u2019": "'", // right single quote / apostrophe
  "\u201a": "'", // single low-9 quote
  "\u201b": "'", // single high-reversed-9 quote
  "\u201c": '"', // left double quote
  "\u201d": '"', // right double quote
  "\u201e": '"', // double low-9 quote
  "\u201f": '"', // double high-reversed-9 quote
  "\u2026": "...", // ellipsis
  "\u2022": "*", // bullet
  "\u00b7": ".", // middle dot
  "\u00a0": " ", // non-breaking space
  "\u2002": " ", // en space
  "\u2003": " ", // em space
  "\u2009": " ", // thin space
  "\u202f": " ", // narrow no-break space
  "\u2190": "<-", // left arrow
  "\u2192": "->", // right arrow
  "\u2264": "<=", // less-than or equal
  "\u2265": ">=", // greater-than or equal
  "\u00d7": "x", // multiplication sign
};

/**
 * The default {@link sanitizeTemplateText} replacement — maps the common
 * typographic characters to readable ASCII and everything else to `?`.
 *
 * @param char - A single disallowed character.
 * @returns Its ASCII stand-in.
 */
export function transliterate(char: string): string {
  return TRANSLITERATIONS[char] ?? "?";
}

/** How many offending characters a message lists before summarising the rest. */
const MAX_LISTED = 3;

function codePoint(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Describes every character in `raw` that CloudFormation will not store
 * verbatim, or `undefined` when there are none.
 *
 * @internal
 */
export function describeOffenders(raw: string): string | undefined {
  if (!HAS_DISALLOWED.test(raw)) return undefined;

  const listed = [...raw.matchAll(DISALLOWED)];
  const formatted = listed
    .slice(0, MAX_LISTED)
    .map(
      ({ 0: char, index }) =>
        `${codePoint(char)} ${JSON.stringify(char)} at index ${String(index)}`,
    );
  const rest = listed.length - formatted.length;

  return rest > 0 ? `${formatted.join(", ")} and ${String(rest)} more` : formatted.join(", ");
}

/**
 * Builds the shared diagnostic. `templateTextPolicy` passes a label naming the
 * construct path and field; the standalone validator names the constraint.
 *
 * @internal
 */
export function templateTextMessage(label: string, offenders: string): string {
  return (
    `${label} contains ${offenders}. CloudFormation stores template text as ASCII and ` +
    `transliterates anything else to "?", so the deployed template will never match the ` +
    `synthesised one and \`cdk diff\` will report a change on every run. ` +
    `Allowed: ${TEMPLATE_TEXT.allowed}. See ${TEMPLATE_TEXT.source}.`
  );
}

/**
 * Validates a string destined for CloudFormation template text. Unresolved
 * CDK tokens are skipped — their value is not knowable at synth (ADR-0010).
 *
 * @param raw - The value to check.
 * @param label - What to name in the error. Defaults to the constraint name.
 * @throws If `raw` contains a character CloudFormation will not store verbatim.
 */
export function validateTemplateText(raw: string, label = TEMPLATE_TEXT.name): void {
  if (Token.isUnresolved(raw)) return;
  const offenders = describeOffenders(raw);
  if (offenders === undefined) return;
  throw new Error(templateTextMessage(label, offenders));
}

/**
 * Returns a copy of `raw` with every character CloudFormation would not store
 * verbatim replaced, so the synthesised template matches the deployed one.
 *
 * Replacement is per character, not per run: collapsing a run the way
 * `sanitizeString` does would turn a quoted phrase into a single `-`, losing
 * more than CloudFormation itself does.
 *
 * @param raw - The value to clean. Unresolved tokens are returned unchanged.
 * @param replace - Maps one disallowed character to its ASCII stand-in.
 * @returns The cleaned value.
 */
export function sanitizeTemplateText(
  raw: string,
  replace: (char: string) => string = transliterate,
): string {
  if (Token.isUnresolved(raw)) return raw;
  return raw.replace(DISALLOWED, replace);
}
