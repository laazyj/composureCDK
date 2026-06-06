/**
 * Character-class fragments shared across multiple AWS-property constraints.
 *
 * Each value is pre-escaped and ordered for use *inside* a `[...]` character
 * class (the `-` is escaped, so position is irrelevant). A constraint spreads
 * these into its own class alongside any property-specific characters, so the
 * common spine is declared once and the per-property tail stays local.
 *
 * A fragment graduates to this file only once a *second* property needs it —
 * promotion is a one-line move plus an import change in the owning packages.
 * See ADR-0009.
 */

/** ASCII letters and digits — the base of nearly every AWS name/description. */
export const ALNUM = "A-Za-z0-9";

/**
 * The punctuation common to AlarmName, SecurityGroup descriptions, and tags
 * (the measured intersection). Individual properties extend this with their
 * own additional characters; they do not redefine the shared set.
 */
export const AWS_NAME_PUNCT = " _./:+=@#()\\-";
