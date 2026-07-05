import { describe, it, expect } from "vitest";
import { ref, combine, resolve, isRef, REF_BRAND, type Resolvable } from "../src/ref.js";

interface FakeResult {
  value: string;
  nested: { id: number };
}

const fakeContext: Record<string, object> = {
  component: { value: "hello", nested: { id: 42 } } satisfies FakeResult,
  other: { name: "world" },
};

describe("Ref", () => {
  describe("ref factory", () => {
    it("creates a Ref that resolves to a component's build output", () => {
      const r = ref<FakeResult>("component");

      const result = r.resolve(fakeContext);

      expect(result).toEqual({ value: "hello", nested: { id: 42 } });
    });

    it("throws when the referenced component is not in context", () => {
      const r = ref<FakeResult>("missing");

      expect(() => r.resolve(fakeContext)).toThrow('Ref to "missing" cannot be resolved');
    });

    it("includes guidance about declaring dependencies in the error", () => {
      const r = ref<FakeResult>("missing");

      expect(() => r.resolve(fakeContext)).toThrow("declared as a dependency");
    });

    it("applies an inline transform when a second argument is provided", () => {
      const r = ref<FakeResult, string>("component", (v) => v.value.toUpperCase());

      expect(r.resolve(fakeContext)).toBe("HELLO");
    });

    it("infers both type params from the callback annotation", () => {
      const r = ref("component", (v: FakeResult) => v.nested.id * 2);

      expect(r.resolve(fakeContext)).toBe(84);
    });
  });

  describe("get", () => {
    it("narrows to a specific property of the resolved value", () => {
      const r = ref<FakeResult>("component").get("value");

      expect(r.resolve(fakeContext)).toBe("hello");
    });

    it("narrows to a nested object property", () => {
      const r = ref<FakeResult>("component").get("nested");

      expect(r.resolve(fakeContext)).toEqual({ id: 42 });
    });

    it("can chain get calls for deep access", () => {
      const r = ref<FakeResult>("component").get("nested").get("id");

      expect(r.resolve(fakeContext)).toBe(42);
    });
  });

  describe("map", () => {
    it("transforms the resolved value", () => {
      const r = ref<FakeResult>("component").map((v) => v.value.toUpperCase());

      expect(r.resolve(fakeContext)).toBe("HELLO");
    });

    it("can chain get and map", () => {
      const r = ref<FakeResult>("component")
        .get("nested")
        .map((n) => n.id * 2);

      expect(r.resolve(fakeContext)).toBe(84);
    });

    it("can map to a different type", () => {
      const r = ref<FakeResult>("component").map((v) => ({
        label: `${v.value}-${String(v.nested.id)}`,
      }));

      expect(r.resolve(fakeContext)).toEqual({ label: "hello-42" });
    });
  });
});

describe("combine", () => {
  it("merges several refs into a record keyed the same as the input", () => {
    const c = combine({
      first: ref<FakeResult>("component"),
      second: ref<{ name: string }>("other"),
    });

    expect(c.resolve(fakeContext)).toEqual({
      first: { value: "hello", nested: { id: 42 } },
      second: { name: "world" },
    });
  });

  it("resolves each entry independently against the context", () => {
    const c = combine({
      value: ref<FakeResult>("component").get("value"),
      name: ref<{ name: string }>("other").get("name"),
    });

    expect(c.resolve(fakeContext)).toEqual({ value: "hello", name: "world" });
  });

  it("applies a transform over the merged record", () => {
    const c = combine(
      {
        value: ref<FakeResult>("component").get("value"),
        name: ref<{ name: string }>("other").get("name"),
      },
      ({ value, name }) => `${value} ${name}`,
    );

    expect(c.resolve(fakeContext)).toBe("hello world");
  });

  it("mixes concrete values and refs", () => {
    const c = combine({
      table: ref<FakeResult>("component"),
      literal: "concrete",
    });

    expect(c.resolve(fakeContext)).toEqual({
      table: { value: "hello", nested: { id: 42 } },
      literal: "concrete",
    });
  });

  it("propagates the component-not-found error from a missing ref", () => {
    const c = combine({
      present: ref<FakeResult>("component"),
      absent: ref<FakeResult>("missing"),
    });

    expect(() => c.resolve(fakeContext)).toThrow('Ref to "missing" cannot be resolved');
  });

  it("returns a real Ref that composes with map and get", () => {
    const c = combine({
      value: ref<FakeResult>("component").get("value"),
      name: ref<{ name: string }>("other").get("name"),
    });

    expect(isRef(c)).toBe(true);
    expect(c.get("value").resolve(fakeContext)).toBe("hello");
    expect(c.map((r) => r.name.toUpperCase()).resolve(fakeContext)).toBe("WORLD");
  });

  it("is interchangeable with a concrete value at a Resolvable seam", () => {
    const c: Resolvable<{ value: string }> = combine({
      value: ref<FakeResult>("component").get("value"),
    });

    expect(resolve(c, fakeContext)).toEqual({ value: "hello" });
  });
});

describe("Resolvable utilities", () => {
  describe("isRef", () => {
    it("returns true for a Ref", () => {
      const r = ref<FakeResult>("component");

      expect(isRef(r)).toBe(true);
    });

    it("returns false for a plain value", () => {
      const value: Resolvable<string> = "hello";

      expect(isRef(value)).toBe(false);
    });

    it("returns false for an object that is not a Ref", () => {
      const value: Resolvable<FakeResult> = { value: "hello", nested: { id: 1 } };

      expect(isRef(value)).toBe(false);
    });

    it("recognises a Ref by its shared brand, not by instanceof", () => {
      // Simulates a Ref minted by a different realm's copy of the module (the
      // dual-package hazard): same Symbol.for brand, different class identity.
      const foreignRef = { [REF_BRAND]: true };

      expect(isRef(foreignRef as unknown as Resolvable<FakeResult>)).toBe(true);
    });
  });

  describe("resolve", () => {
    it("resolves a Ref against context", () => {
      const r: Resolvable<FakeResult> = ref<FakeResult>("component");

      expect(resolve(r, fakeContext)).toEqual({ value: "hello", nested: { id: 42 } });
    });

    it("passes through a concrete value unchanged", () => {
      const value: Resolvable<string> = "hello";

      expect(resolve(value, fakeContext)).toBe("hello");
    });

    it("passes through an object value unchanged", () => {
      const value: Resolvable<FakeResult> = { value: "concrete", nested: { id: 0 } };

      expect(resolve(value, fakeContext)).toEqual({ value: "concrete", nested: { id: 0 } });
    });
  });
});
