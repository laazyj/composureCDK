/**
 * Character-class fragments shared across multiple AWS-property constraints.
 *
 * Each value is pre-escaped and ordered for use *inside* a `[...]` character
 * class (the `-` is escaped, so position is irrelevant). A constraint spreads
 * these into its own class alongside any property-specific characters, so the
 * common spine is declared once and the per-property tail stays local.
 *
 * They are grouped under a single {@link charSets} export to keep the package
 * surface tidy. A fragment graduates here only once a *second* property needs
 * it — promotion is a one-line move plus an import change in the owning
 * packages. See ADR-0010.
 */

/** ASCII letters and digits — the base of nearly every AWS name/description. */
const ALNUM = "A-Za-z0-9";

/**
 * The punctuation common to AlarmName, SecurityGroup descriptions, and tags
 * (the measured intersection). Individual properties extend this with their
 * own additional characters; they do not redefine the shared set.
 */
const AWS_NAME_PUNCT = " _./:+=@#()\\-";

/**
 * Shared character-class fragments. Spread one into a constraint's `charClass`:
 * `` charClass: `${charSets.ALNUM}${charSets.AWS_NAME_PUNCT}...` ``.
 */
export const charSets = { ALNUM, AWS_NAME_PUNCT } as const;
