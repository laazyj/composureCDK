/**
 * Asserts at compile time that `Source` is assignable to `Target`. Purely
 * type-level — it takes no value and its body is empty.
 *
 * This is how the ADR-0018 type-level guards are written: a builder's
 * re-declared props must accept everything CDK's own props accept, so that a
 * later re-declaration cannot silently narrow the builder's surface.
 *
 * ```ts
 * it("accepts everything CDK's own KeyProps accepts (type-level guard)", () => {
 *   assertAssignable<KeyBuilderProps, KeyProps>();
 * });
 * ```
 *
 * vitest does not typecheck, so a violation surfaces from `tsc` — the
 * `typecheck` target, which nx runs before `test`.
 *
 * ## Why not `assertType` or `expectTypeOf`
 *
 * vitest's `assertType<T>(value: T)` makes the same assignability check, and is
 * not gated on `--typecheck` (its runtime implementation is an empty function).
 * It is weaker here on two counts: it needs a value, so each site carries an
 * `undefined as unknown as CdkProps` cast to conjure one; and dropping its type
 * argument infers `T` from that argument and passes vacuously, where dropping
 * one here is `error TS2558: Expected 2 type arguments, but got 1`.
 *
 * `expectTypeOf(...).toExtend()` is a different check. It is a
 * conditional-type `extends`, which distributes over unions — a union passes if
 * each member extends the target individually. Assignability asks whether the
 * union as a whole is assignable, and a generic constraint does not distribute.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters, @typescript-eslint/no-unused-vars --
   Both rules flag type parameters unused in the value signature. Here that is
   the point: the parameters exist only to be checked against each other. */
export function assertAssignable<Target, Source extends Target>(): void {
  // Type-level only: the constraint above is the entire assertion.
}
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters, @typescript-eslint/no-unused-vars --
   Restores both rules for anything added below. */
