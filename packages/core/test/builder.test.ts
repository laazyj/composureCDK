import { describe, it, expect, vi } from "vitest";
import { Builder, COPY_STATE, type IBuilder } from "../src/builder.js";

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

  describe("copy", () => {
    it("returns a chainable builder of the same shape", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget).name("Alice").count(5);

      const copy = builder.copy();

      expect(copy.name()).toBe("Alice");
      expect(copy.count()).toBe(5);
      expect(copy.greet()).toBe("Hello, Alice");
    });

    it("preserves all configured props", () => {
      const builder = Builder<PropsWithDefaults, TargetWithDefaults>(TargetWithDefaults)
        .enabled(false)
        .timeout(60);

      const copy = builder.copy();

      expect(copy.enabled()).toBe(false);
      expect(copy.timeout()).toBe(60);
    });

    it("isolates the copy from later mutations to the original", () => {
      const original = Builder<SimpleProps, SimpleTarget>(SimpleTarget).name("Alice").count(5);

      const copy = original.copy();
      original.name("Bob").count(99);

      expect(copy.name()).toBe("Alice");
      expect(copy.count()).toBe(5);
    });

    it("isolates the original from later mutations to the copy", () => {
      const original = Builder<SimpleProps, SimpleTarget>(SimpleTarget).name("Alice").count(5);

      const copy = original.copy();
      copy.name("Bob").count(99);

      expect(original.name()).toBe("Alice");
      expect(original.count()).toBe(5);
    });

    it("shares nested object references (shallow clone)", () => {
      interface NestedProps {
        config: { key: string };
      }
      class NestedTarget {
        props: Partial<NestedProps> = {};
      }

      const config = { key: "value" };
      const builder = Builder<NestedProps, NestedTarget>(NestedTarget).config(config);

      const copy = builder.copy();

      expect(copy.config()).toBe(config);
      expect(copy.config()).toBe(builder.config());
    });

    it("invokes [COPY_STATE] when defined on the underlying class", () => {
      const hook = vi.fn();
      class WithHook {
        props: Partial<SimpleProps> = {};
        [COPY_STATE](next: WithHook): void {
          hook(next);
        }
      }

      const builder = Builder<SimpleProps, WithHook>(WithHook).name("Alice");

      builder.copy();

      expect(hook).toHaveBeenCalledOnce();
      const arg = hook.mock.calls[0]?.[0] as WithHook | undefined;
      expect(arg).toBeInstanceOf(WithHook);
      expect(arg?.props.name).toBe("Alice");
    });

    it("uses [COPY_STATE] to deep-clone class-private state", () => {
      class WithAccumulator {
        props: Partial<SimpleProps> = {};
        readonly #items: string[] = [];

        add(value: string): this {
          this.#items.push(value);
          return this;
        }

        items(): readonly string[] {
          return this.#items;
        }

        [COPY_STATE](next: WithAccumulator): void {
          next.#items.push(...this.#items);
        }
      }

      const original = Builder<SimpleProps, WithAccumulator>(WithAccumulator)
        .name("Alice")
        .add("first")
        .add("second");

      const copy = original.copy();
      original.add("after-copy");
      copy.add("on-copy-only");

      expect(original.items()).toEqual(["first", "second", "after-copy"]);
      expect(copy.items()).toEqual(["first", "second", "on-copy-only"]);
    });

    it("works on classes without a [COPY_STATE] hook", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget).name("Alice");

      expect(() => builder.copy()).not.toThrow();
      expect(builder.copy().name()).toBe("Alice");
    });

    it("copies an unconfigured builder with no props set", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget);

      const copy = builder.copy();

      expect(copy.name()).toBeUndefined();
      expect(copy.count()).toBeUndefined();
      copy.name("Alice");
      expect(builder.name()).toBeUndefined();
    });

    it("supports repeated copying", () => {
      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget).name("Alice").count(5);

      const a = builder.copy();
      const b = a.copy().name("Bob");

      expect(builder.name()).toBe("Alice");
      expect(a.name()).toBe("Alice");
      expect(b.name()).toBe("Bob");
      expect(b.count()).toBe(5);
    });

    it("wraps a pre-instantiated instance when invoked directly", () => {
      const instance = new SimpleTarget();
      instance.props = { name: "Alice", count: 5 };

      const builder = Builder<SimpleProps, SimpleTarget>(SimpleTarget, instance);

      expect(builder.name()).toBe("Alice");
      expect(builder.count()).toBe(5);
    });
  });
});
