import { describe, it, expect, vi } from "vitest";
import { Builder, type IBuilder } from "../src/builder.js";

// -- Test fixtures --

interface SimpleProps {
  name: string;
  count: number;
}

class SimpleTarget {
  props: Partial<SimpleProps> = {};

  greet(): string {
    return `Hello, ${String(this.props.name)}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface EmptyProps {}

class EmptyTarget {
  props: Partial<EmptyProps> = {};

  value(): string {
    return "empty";
  }
}

interface ChainableProps {
  label: string;
}

class ChainableTarget {
  props: Partial<ChainableProps> = {};

  configure(): this {
    return this;
  }

  compute(): number {
    return 42;
  }
}

interface PropsWithDefaults {
  enabled: boolean;
  timeout: number;
}

class TargetWithDefaults {
  props: Partial<PropsWithDefaults> = {
    enabled: true,
    timeout: 30,
  };
}

// -- Tests --

describe("Builder", () => {
  describe("construction", () => {
    it("creates a builder from a class constructor", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);
      expect(builder).toBeDefined();
    });

    it("eagerly instantiates the underlying class", () => {
      const spy = vi.fn();
      class Tracked {
        props: Partial<SimpleProps> = {};
        constructor() {
          spy();
        }
      }

      Builder<SimpleProps, Tracked>(Tracked);

      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("prop getter/setter", () => {
    it("returns undefined for unset props", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      expect(builder.name()).toBeUndefined();
      expect(builder.count()).toBeUndefined();
    });

    it("sets a prop and returns the builder for chaining", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      const returned = builder.name("Alice");

      expect(returned).toBe(builder);
      expect(builder.name()).toBe("Alice");
    });

    it("supports chaining multiple prop setters", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      builder.name("Alice").count(5);

      expect(builder.name()).toBe("Alice");
      expect(builder.count()).toBe(5);
    });

    it("overwrites a previously set prop", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      builder.name("Alice").name("Bob");

      expect(builder.name()).toBe("Bob");
    });

    it("preserves default prop values", () => {
      const builder = Builder<PropsWithDefaults, TargetWithDefaults>(TargetWithDefaults);

      expect(builder.enabled()).toBe(true);
      expect(builder.timeout()).toBe(30);
    });

    it("overrides default prop values", () => {
      const builder = Builder<PropsWithDefaults, TargetWithDefaults>(TargetWithDefaults);

      builder.enabled(false).timeout(60);

      expect(builder.enabled()).toBe(false);
      expect(builder.timeout()).toBe(60);
    });
  });

  describe("method delegation", () => {
    it("delegates non-chainable methods to the underlying instance", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      builder.name("Alice");
      const result = builder.greet();

      expect(result).toBe("Hello, Alice");
    });

    it("wraps chainable methods to return the builder", () => {
      const builder = Builder<ChainableProps, ChainableTarget>(ChainableTarget);

      const returned = builder.configure();

      expect(returned).toBe(builder);
    });

    it("returns the raw result for non-chainable methods", () => {
      const builder = Builder<ChainableProps, ChainableTarget>(ChainableTarget);

      const result = builder.compute();

      expect(result).toBe(42);
    });
  });

  describe("empty props", () => {
    it("creates a builder with no settable props", () => {
      const builder = Builder<EmptyProps, EmptyTarget>(EmptyTarget);

      expect(builder.value()).toBe("empty");
    });
  });

  describe("prop mutation", () => {
    it("mutates the underlying instance props", () => {
      class Inspectable {
        props: Partial<SimpleProps> = {};
        getProps(): Partial<SimpleProps> {
          return this.props;
        }
      }

      const builder = Builder<SimpleProps, Inspectable>(Inspectable);
      builder.name("Alice").count(5);

      expect(builder.getProps()).toEqual({ name: "Alice", count: 5 });
    });

    it("clears a prop when set to undefined", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      builder.name("Alice");
      expect(builder.name()).toBe("Alice");

      builder.name(undefined as unknown as string);
      expect(builder.name()).toBeUndefined();
    });
  });

  describe("proxy behaviour", () => {
    it("returns a getter/setter function for unknown properties", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget) as IBuilder<
        SimpleProps,
        SimpleTarget
      > &
        Record<string, unknown>;

      // eslint-disable-next-line @typescript-eslint/dot-notation
      const accessor = builder["nonexistent"];
      expect(typeof accessor).toBe("function");
    });

    it("passes symbol access through to the underlying instance", () => {
      const sym = Symbol("test");

      class WithSymbol {
        props: Partial<SimpleProps> = {};
        [Symbol.toPrimitive](): string {
          return "symbolic";
        }
      }

      (WithSymbol.prototype as unknown as Record<symbol, unknown>)[sym] = "sym-value";

      const builder = Builder<SimpleProps, WithSymbol>(WithSymbol);
      expect((builder as unknown as Record<symbol, unknown>)[sym]).toBe("sym-value");
    });

    it("creates an independent instance per Builder call", () => {
      const builder1 = Builder<SimpleProps, SimpleTarget>(SimpleTarget);
      const builder2 = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      builder1.name("Alice");
      builder2.name("Bob");

      expect(builder1.name()).toBe("Alice");
      expect(builder2.name()).toBe("Bob");
    });
  });
});
