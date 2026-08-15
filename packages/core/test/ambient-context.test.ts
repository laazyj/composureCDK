import { afterEach, describe, it, expect } from "vitest";
import {
  currentAmbientContext,
  resetAmbientContext,
  withAmbientContext,
} from "../src/ambient-context.js";
import { ref, resolve } from "../src/ref.js";

interface FakeResult extends Record<string, object> {
  value: { id: string };
}

afterEach(() => {
  resetAmbientContext();
});

describe("ambient build context", () => {
  it("is undefined outside any build", () => {
    expect(currentAmbientContext()).toBeUndefined();
  });

  it("exposes the installed context for the duration of the call", () => {
    const context = { comp: { value: { id: "a" } } };

    const seen = withAmbientContext(context, () => currentAmbientContext());

    expect(seen).toBe(context);
    expect(currentAmbientContext()).toBeUndefined();
  });

  it("nests, with the innermost context winning", () => {
    const outer = { comp: { value: { id: "outer" } } };
    const inner = { comp: { value: { id: "inner" } } };

    withAmbientContext(outer, () => {
      expect(currentAmbientContext()).toBe(outer);
      withAmbientContext(inner, () => {
        expect(currentAmbientContext()).toBe(inner);
      });
      // The inner frame is popped, restoring the enclosing build's context.
      expect(currentAmbientContext()).toBe(outer);
    });
  });

  it("pops its frame when the build throws, so the next build starts clean", () => {
    const context = { comp: { value: { id: "a" } } };

    expect(() =>
      withAmbientContext(context, () => {
        throw new Error("build failed");
      }),
    ).toThrow("build failed");

    expect(currentAmbientContext()).toBeUndefined();
  });

  it("does not push a frame for an undefined context", () => {
    const outer = { comp: { value: { id: "outer" } } };

    withAmbientContext(outer, () => {
      // A standalone `build(scope, id)` nested inside a composed build must not
      // shadow the enclosing context with an empty one.
      withAmbientContext(undefined, () => {
        expect(currentAmbientContext()).toBe(outer);
      });
    });
  });
});

describe("resolve with an ambient context", () => {
  it("falls back to the ambient context when given none", () => {
    const context = { comp: { value: { id: "resolved" } } };
    const r = ref<FakeResult>("comp").get("value");

    const resolved = withAmbientContext(context, () => resolve(r, undefined));

    expect(resolved).toEqual({ id: "resolved" });
  });

  it("still throws outside a build, where there is no ambient context", () => {
    const r = ref<FakeResult>("comp").get("value");

    expect(() => resolve(r, undefined)).toThrow('Ref to "comp" cannot be resolved');
  });

  it("prefers an explicit context over the ambient one", () => {
    const ambient = { comp: { value: { id: "ambient" } } };
    const explicit = { comp: { value: { id: "explicit" } } };
    const r = ref<FakeResult>("comp").get("value");

    const resolved = withAmbientContext(ambient, () => resolve(r, explicit));

    expect(resolved).toEqual({ id: "explicit" });
  });

  it("leaves concrete values untouched", () => {
    const context = { comp: { value: { id: "ambient" } } };

    const resolved = withAmbientContext(context, () => resolve({ id: "concrete" }, undefined));

    expect(resolved).toEqual({ id: "concrete" });
  });

  it("keeps its stack on the global symbol registry, not in module scope", () => {
    // The dual-package hazard (ADR-0007): ESM and CommonJS copies of this
    // package can both load in one process. Module-scoped state would give
    // each its own stack, so an ESM push would be invisible to a CommonJS
    // resolve — the exact failure this mechanism exists to prevent, visible
    // only in a dual-loaded process. Asserting the frame is reachable through
    // `Symbol.for` is what proves a second copy would see it.
    const key = Symbol.for("composurecdk.ambientContextStack");
    const context = { comp: { value: { id: "cross-realm" } } };

    withAmbientContext(context, () => {
      const shared = (globalThis as Record<symbol, unknown>)[key] as Record<string, object>[];
      expect(shared.at(-1)).toBe(context);
    });
  });
});
