/**
 * Ambient build context — an experimental alternative to threading `context`
 * by hand through every sub-builder call site.
 *
 * ## The problem this explores
 *
 * A builder that delegates to a sub-builder must forward its build context, or
 * the sub-builder resolves refs against `{}` and any `ref()` the caller passed
 * through a `configure` callback throws "component not found in context". The
 * forwarding is invisible when omitted: nothing fails until a consumer happens
 * to use a ref through that seam. Issue 386 found five such call sites.
 *
 * Explicit threading is correct but has to be remembered at every call site,
 * forever, by everyone — including consumers writing their own builders, whom
 * no lint rule in this repo can reach.
 *
 * ## The mechanism
 *
 * `compose` and the builder wrapper push the context they are building with
 * onto a stack for the duration of that `build()` call. {@link resolve} falls
 * back to the top of the stack when it is handed no context of its own. A
 * sub-builder built inside an enclosing `build()` therefore inherits the
 * enclosing context automatically, whether or not anyone passed it down.
 *
 * An explicit `context` argument always wins — this is a fallback for the
 * `undefined` case, never an override.
 *
 * ## Why the stack lives on `globalThis`
 *
 * Every publishable package here ships dual ESM/CJS (ADR-0007), so two copies
 * of `@composurecdk/core` can load in one process. Module-scoped state would
 * give each copy its own stack: an ESM builder pushing a context that a
 * CommonJS `resolve` cannot see, failing exactly the way this mechanism exists
 * to prevent, and only in a dual-loaded process. Keying the stack off
 * `Symbol.for(...)` on `globalThis` puts both copies on the same array — the
 * same technique {@link REF_BRAND} uses for cross-realm identity.
 *
 * ## Why a plain synchronous stack is safe
 *
 * CDK synthesis is synchronous: `Lifecycle.build` returns `T`, never a
 * promise, so no two builds interleave on one stack. Every push is paired with
 * a `finally` pop so a throwing build cannot leak its frame. If `build` ever
 * became async this would need `AsyncLocalStorage`, which is Node-only.
 *
 * @experimental Under evaluation — see the PR that introduced this file.
 */

const AMBIENT_CONTEXT_STACK = Symbol.for("composurecdk.ambientContextStack");

type GlobalWithStack = typeof globalThis & {
  [AMBIENT_CONTEXT_STACK]?: Record<string, object>[];
};

function stack(): Record<string, object>[] {
  const g = globalThis as GlobalWithStack;
  return (g[AMBIENT_CONTEXT_STACK] ??= []);
}

/**
 * Runs `fn` with `context` installed as the ambient build context.
 *
 * Pairs every push with a pop, including when `fn` throws, so a failed build
 * cannot leave a stale frame behind for the next one.
 *
 * @param context - The context to make ambient, or `undefined` to run `fn`
 *   without pushing a frame. `undefined` deliberately does not push: a
 *   standalone `build(scope, id)` should not shadow an enclosing context with
 *   an empty one.
 * @param fn - The build to run.
 * @returns Whatever `fn` returns.
 */
export function withAmbientContext<T>(context: Record<string, object> | undefined, fn: () => T): T {
  if (context === undefined) return fn();

  const frames = stack();
  frames.push(context);
  try {
    return fn();
  } finally {
    frames.pop();
  }
}

/**
 * The innermost ambient build context, or `undefined` when no build is in
 * progress. Consumed by {@link resolve} as its fallback.
 */
export function currentAmbientContext(): Record<string, object> | undefined {
  const frames = stack();
  return frames.length > 0 ? frames[frames.length - 1] : undefined;
}

/**
 * Clears the ambient stack. Test-only escape hatch for asserting that a
 * failed build left nothing behind.
 *
 * @internal
 */
export function resetAmbientContext(): void {
  (globalThis as GlobalWithStack)[AMBIENT_CONTEXT_STACK] = [];
}
