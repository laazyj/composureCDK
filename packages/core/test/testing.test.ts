import { describe, it, expect } from "vitest";
import { Builder, COPY_STATE, type IBuilder } from "../src/builder.js";
import { assertCopyPreservesState } from "../src/testing.js";

interface Props {
  name: string;
}

class WithAccumulator {
  props: Partial<Props> = {};
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

class WithoutCopyState {
  props: Partial<Props> = {};
  readonly #items: string[] = [];

  add(value: string): this {
    this.#items.push(value);
    return this;
  }

  items(): readonly string[] {
    return this.#items;
  }
}

interface BuildResult {
  items: readonly string[];
}

function buildResult(b: IBuilder<Props, WithAccumulator | WithoutCopyState>): BuildResult {
  return { items: [...b.items()] };
}

describe("assertCopyPreservesState", () => {
  it("passes when [COPY_STATE] preserves accumulator state across .copy()", () => {
    expect(() => {
      assertCopyPreservesState({
        factory: () => Builder<Props, WithAccumulator>(WithAccumulator),
        configure: (b) => {
          b.add("first");
        },
        mutate: (b) => {
          b.add("after-copy");
        },
        build: buildResult,
        inspect: (r) => r.items,
      });
    }).not.toThrow();
  });

  it("fails when [COPY_STATE] is missing — copy diverges from baseline", () => {
    expect(() => {
      assertCopyPreservesState({
        factory: () => Builder<Props, WithoutCopyState>(WithoutCopyState),
        configure: (b) => {
          b.add("first");
        },
        mutate: (b) => {
          b.add("after-copy");
        },
        build: buildResult,
        inspect: (r) => r.items,
      });
    }).toThrow(/COPY_STATE/);
  });

  it("fails when `mutate` is a no-op so the helper cannot detect a leak", () => {
    expect(() => {
      assertCopyPreservesState({
        factory: () => Builder<Props, WithAccumulator>(WithAccumulator),
        configure: (b) => {
          b.add("first");
        },
        mutate: () => {
          /* no-op */
        },
        build: buildResult,
        inspect: (r) => r.items,
      });
    }).toThrow(/mutate.*did not change/);
  });

  it("fails when `mutate` changes state that `inspect` does not surface", () => {
    expect(() => {
      assertCopyPreservesState({
        factory: () => Builder<Props, WithAccumulator>(WithAccumulator),
        configure: (b) => {
          b.add("first");
        },
        // Mutates a prop, not the accumulator that `inspect` returns.
        mutate: (b) => {
          b.name("changed");
        },
        build: buildResult,
        inspect: (r) => r.items,
      });
    }).toThrow(/mutate.*did not change/);
  });

  it("invokes build three times, each on a distinct builder instance", () => {
    const seen: object[] = [];
    assertCopyPreservesState({
      factory: () => Builder<Props, WithAccumulator>(WithAccumulator),
      configure: (b) => {
        b.add("first");
      },
      mutate: (b) => {
        b.add("after-copy");
      },
      build: (b) => {
        seen.push(b);
        return buildResult(b);
      },
      inspect: (r) => r.items,
    });
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("fails with a clear error when the builder lacks .copy()", () => {
    const noCopyBuilder = {
      props: {} as Partial<Props>,
      add() {
        return this;
      },
      items: () => [] as readonly string[],
    };

    expect(() => {
      assertCopyPreservesState({
        factory: () => noCopyBuilder as unknown as IBuilder<Props, WithAccumulator>,
        configure: () => {
          /* no-op */
        },
        mutate: () => {
          /* no-op */
        },
        build: buildResult,
        inspect: (r) => r.items,
      });
    }).toThrow(/no `\.copy\(\)` method/);
  });

  it("compares non-trivially structured inspectable state via deep equality", () => {
    interface NestedResult {
      tree: { children: { name: string }[] };
    }
    class Tree {
      props: Partial<Props> = {};
      readonly #children: { name: string }[] = [];

      addChild(name: string): this {
        this.#children.push({ name });
        return this;
      }

      snapshot(): NestedResult {
        return { tree: { children: this.#children.map((c) => ({ ...c })) } };
      }

      [COPY_STATE](next: Tree): void {
        next.#children.push(...this.#children.map((c) => ({ ...c })));
      }
    }

    expect(() => {
      assertCopyPreservesState({
        factory: () => Builder<Props, Tree>(Tree),
        configure: (b) => {
          b.addChild("a");
        },
        mutate: (b) => {
          b.addChild("b");
        },
        build: (b) => b.snapshot(),
        inspect: (r) => r.tree.children,
      });
    }).not.toThrow();
  });
});
