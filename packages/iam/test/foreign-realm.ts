import type { StatementBuilder } from "../src/statement-builder.js";

/**
 * Re-parents a {@link StatementBuilder} onto a copy of its own prototype, so it
 * behaves exactly like one minted by the other realm's copy of
 * `@composurecdk/iam` under the dual-package hazard (ADR-0007): every method
 * present and working, the instance-level brand intact, but
 * `instanceof StatementBuilder` false.
 *
 * Both halves matter. The private fields `build()` reads live on the instance,
 * so swapping the prototype leaves the builder fully functional — a cross-realm
 * builder is not broken, merely unrecognisable to `instanceof`. And the brand
 * is a class field, also on the instance, so it survives the swap: the guard
 * still sees it where `instanceof` does not, which is the whole difference
 * these tests exercise.
 */
export function asForeignRealm(builder: StatementBuilder): StatementBuilder {
  const proto = Object.getPrototypeOf(builder) as object;
  const clonedProto = Object.defineProperties({}, Object.getOwnPropertyDescriptors(proto));
  Object.setPrototypeOf(builder, clonedProto);
  return builder;
}
