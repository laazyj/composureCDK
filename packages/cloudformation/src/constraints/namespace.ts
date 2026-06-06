/**
 * The shape every package's `constraints` export conforms to.
 *
 * Discoverability is a convention, not a runtime aggregate: each builder
 * package exposes its own `constraints` object of this shape, so the calling
 * pattern (`constraints.validate.*` / `constraints.sanitize.*`) is identical
 * everywhere and a consumer imports only the package they already use. The
 * browsable index of the whole catalogue is a generated doc, not an import.
 * See ADR-0009.
 */
export interface ConstraintNamespace {
  /** Throwing validators for user-authored values the author can fix. */
  readonly validate: Readonly<Record<string, (raw: string) => void>>;
  /** Transforming sanitisers for derived values the author does not control. */
  readonly sanitize: Readonly<Record<string, (raw: string) => string>>;
}
