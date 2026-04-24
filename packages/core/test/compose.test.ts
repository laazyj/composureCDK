import { describe, it, expect, vi } from "vitest";
import { Construct } from "constructs";
import { compose, type AfterBuildHook } from "../src/compose.js";
import { groupedStacks } from "../src/stack-strategy.js";
import { CyclicDependencyError } from "../src/cyclic-dependency-error.js";
import { type Lifecycle } from "../src/lifecycle.js";
import { ref, resolve, type Resolvable } from "../src/ref.js";

function createScope(): Construct {
  return new Construct(undefined as never, "root");
}

function stubComponent<T extends Record<string, unknown>>(result: T): Lifecycle<T> {
  return {
    build: () => result,
  };
}

function spyComponent<T extends Record<string, unknown>>(result: T) {
  const build = vi.fn<Lifecycle<T>["build"]>().mockReturnValue(result);
  return { lifecycle: { build } as Lifecycle<T>, build };
}

describe("compose", () => {
  describe("cycle detection", () => {
    it("throws CyclicDependencyError for a direct cycle", () => {
      expect(() =>
        compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: ["b"], b: ["a"] }),
      ).toThrow(CyclicDependencyError);
    });

    it("throws CyclicDependencyError for a transitive cycle", () => {
      expect(() =>
        compose(
          {
            a: stubComponent({ x: 1 }),
            b: stubComponent({ y: 2 }),
            c: stubComponent({ z: 3 }),
          },
          { a: ["c"], b: ["a"], c: ["b"] },
        ),
      ).toThrow(CyclicDependencyError);
    });

    it("includes the cycle path in the error", () => {
      try {
        compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: ["b"], b: ["a"] });
        expect.fail("Expected CyclicDependencyError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CyclicDependencyError);
        const cycleError = error as CyclicDependencyError;
        expect(cycleError.cycles.length).toBeGreaterThan(0);
        expect(cycleError.cycles.flat()).toContain("a");
        expect(cycleError.cycles.flat()).toContain("b");
      }
    });
  });

  describe("build order", () => {
    it("builds a single component with no dependencies", () => {
      const system = compose({ db: stubComponent({ connection: "pg://localhost" }) }, { db: [] });

      const result = system.build(createScope(), "test", {});

      expect(result.db).toEqual({ connection: "pg://localhost" });
    });

    it("builds components in dependency order", () => {
      const buildOrder: string[] = [];

      const db: Lifecycle = {
        build: (_scope, id) => {
          buildOrder.push(id);
          return { connection: "pg://localhost" };
        },
      };
      const server: Lifecycle = {
        build: (_scope, id) => {
          buildOrder.push(id);
          return { port: 8080 };
        },
      };

      const system = compose({ server, db }, { server: ["db"], db: [] });
      system.build(createScope(), "app", {});

      expect(buildOrder).toEqual(["app/db", "app/server"]);
    });

    it("handles a diamond dependency graph", () => {
      const buildOrder: string[] = [];

      const makeComponent = (name: string): Lifecycle => ({
        build: (_scope, id) => {
          buildOrder.push(id);
          return { name };
        },
      });

      const system = compose(
        {
          base: makeComponent("base"),
          left: makeComponent("left"),
          right: makeComponent("right"),
          top: makeComponent("top"),
        },
        {
          base: [],
          left: ["base"],
          right: ["base"],
          top: ["left", "right"],
        },
      );

      system.build(createScope(), "app", {});

      const baseIdx = buildOrder.indexOf("app/base");
      const leftIdx = buildOrder.indexOf("app/left");
      const rightIdx = buildOrder.indexOf("app/right");
      const topIdx = buildOrder.indexOf("app/top");

      expect(baseIdx).toBeLessThan(leftIdx);
      expect(baseIdx).toBeLessThan(rightIdx);
      expect(leftIdx).toBeLessThan(topIdx);
      expect(rightIdx).toBeLessThan(topIdx);
    });
  });

  describe("context resolution", () => {
    it("passes an empty context to components with no dependencies", () => {
      const { lifecycle, build } = spyComponent({ value: 1 });

      const system = compose({ a: lifecycle }, { a: [] });
      system.build(createScope(), "test", {});

      expect(build).toHaveBeenCalledOnce();
      expect(build.mock.calls[0][2]).toEqual({});
    });

    it("passes resolved dependency outputs as context", () => {
      const db: Lifecycle = {
        build: () => ({ connection: "pg://localhost" }),
      };
      const { lifecycle: server, build: serverBuild } = spyComponent({ port: 8080 });

      const system = compose({ db, server }, { db: [], server: ["db"] });
      system.build(createScope(), "app", {});

      expect(serverBuild.mock.calls[0][2]).toEqual({
        db: { connection: "pg://localhost" },
      });
    });

    it("passes multiple resolved dependencies as context", () => {
      const db: Lifecycle = {
        build: () => ({ connection: "pg://localhost" }),
      };
      const cache: Lifecycle = {
        build: () => ({ url: "redis://localhost" }),
      };
      const { lifecycle: server, build: serverBuild } = spyComponent({ port: 8080 });

      const system = compose({ db, cache, server }, { db: [], cache: [], server: ["db", "cache"] });
      system.build(createScope(), "app", {});

      expect(serverBuild.mock.calls[0][2]).toEqual({
        db: { connection: "pg://localhost" },
        cache: { url: "redis://localhost" },
      });
    });

    it("passes transitive dependency outputs through the chain", () => {
      const db: Lifecycle = {
        build: () => ({ connection: "pg://localhost" }),
      };
      const repo: Lifecycle = {
        build: (_scope, _id, context: Record<string, Record<string, unknown>>) => ({
          query: `repo using ${String(context.db.connection)}`,
        }),
      };
      const { lifecycle: service, build: serviceBuild } = spyComponent({ status: "ok" });

      const system = compose({ db, repo, service }, { db: [], repo: ["db"], service: ["repo"] });
      system.build(createScope(), "app", {});

      expect(serviceBuild.mock.calls[0][2]).toEqual({
        repo: { query: "repo using pg://localhost" },
      });
    });
  });

  describe("build result", () => {
    it("returns the combined outputs of all components", () => {
      const system = compose(
        {
          db: stubComponent({ connection: "pg://localhost" }),
          cache: stubComponent({ url: "redis://localhost" }),
          server: stubComponent({ port: 8080 }),
        },
        { db: [], cache: [], server: ["db", "cache"] },
      );

      const result = system.build(createScope(), "app", {});

      expect(result).toEqual({
        db: { connection: "pg://localhost" },
        cache: { url: "redis://localhost" },
        server: { port: 8080 },
      });
    });
  });

  describe("scope and id propagation", () => {
    it("passes scope to each component", () => {
      const { lifecycle, build } = spyComponent({ value: 1 });
      const scope = createScope();

      const system = compose({ a: lifecycle }, { a: [] });
      system.build(scope, "test");

      expect(build.mock.calls[0][0]).toBe(scope);
    });

    it("passes a scoped id to each component", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });

      const system = compose({ a, b }, { a: [], b: ["a"] });
      system.build(createScope(), "myapp");

      expect(aBuild.mock.calls[0][1]).toBe("myapp/a");
      expect(bBuild.mock.calls[0][1]).toBe("myapp/b");
    });
  });

  describe("withStacks", () => {
    it("routes a component to a specific scope", () => {
      const { lifecycle, build } = spyComponent({ value: 1 });
      const defaultScope = createScope();
      const customScope = new Construct(undefined as never, "custom");

      compose({ a: lifecycle }, { a: [] })
        .withStacks({ a: customScope })
        .build(defaultScope, "test");

      expect(build.mock.calls[0][0]).toBe(customScope);
    });

    it("falls back to default scope for components not in the stacks map", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });
      const defaultScope = createScope();
      const customScope = new Construct(undefined as never, "custom");

      compose({ a, b }, { a: [], b: ["a"] })
        .withStacks({ a: customScope })
        .build(defaultScope, "test");

      expect(aBuild.mock.calls[0][0]).toBe(customScope);
      expect(bBuild.mock.calls[0][0]).toBe(defaultScope);
    });

    it("supports multiple components routed to different scopes", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });
      const { lifecycle: c, build: cBuild } = spyComponent({ z: 3 });
      const scopeA = new Construct(undefined as never, "scopeA");
      const scopeB = new Construct(undefined as never, "scopeB");
      const defaultScope = createScope();

      compose({ a, b, c }, { a: [], b: ["a"], c: ["b"] })
        .withStacks({ a: scopeA, b: scopeB })
        .build(defaultScope, "test");

      expect(aBuild.mock.calls[0][0]).toBe(scopeA);
      expect(bBuild.mock.calls[0][0]).toBe(scopeB);
      expect(cBuild.mock.calls[0][0]).toBe(defaultScope);
    });

    it("still resolves cross-component dependencies across scopes", () => {
      const db: Lifecycle = {
        build: () => ({ connection: "pg://localhost" }),
      };
      const { lifecycle: server, build: serverBuild } = spyComponent({ port: 8080 });
      const scopeA = new Construct(undefined as never, "scopeA");
      const scopeB = new Construct(undefined as never, "scopeB");

      compose({ db, server }, { db: [], server: ["db"] })
        .withStacks({ db: scopeA, server: scopeB })
        .build(createScope(), "app");

      expect(serverBuild.mock.calls[0][2]).toEqual({
        db: { connection: "pg://localhost" },
      });
    });

    it("returns a Lifecycle that can be used as a component in another compose", () => {
      const inner = compose(
        {
          a: stubComponent({ x: 1 }),
          b: stubComponent({ y: 2 }),
        },
        { a: [], b: ["a"] },
      );

      const system = compose({ sub: inner, c: stubComponent({ z: 3 }) }, { sub: [], c: ["sub"] });

      const result = system.build(createScope(), "app");

      expect(result.sub).toEqual({ a: { x: 1 }, b: { y: 2 } });
      expect(result.c).toEqual({ z: 3 });
    });
  });

  describe("withStackStrategy", () => {
    it("routes components to scopes determined by the strategy", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });
      const scope = createScope();

      const classify = (key: string) => (key === "a" ? "groupA" : "groupB");
      const factory = (parent: Construct, id: string) => new Construct(parent, id);

      compose({ a, b }, { a: [], b: ["a"] })
        .withStackStrategy(groupedStacks(classify, factory))
        .build(scope, "sys");

      expect(aBuild.mock.calls[0][0]).not.toBe(scope);
      expect(bBuild.mock.calls[0][0]).not.toBe(scope);
      expect(aBuild.mock.calls[0][0]).not.toBe(bBuild.mock.calls[0][0]);
    });

    it("still resolves dependencies across strategy-assigned scopes", () => {
      const db: Lifecycle = {
        build: () => ({ connection: "pg://localhost" }),
      };
      const { lifecycle: server, build: serverBuild } = spyComponent({ port: 8080 });
      const scope = createScope();

      compose({ db, server }, { db: [], server: ["db"] })
        .withStackStrategy(
          groupedStacks(
            (key) => (key === "db" ? "data" : "compute"),
            (parent, id) => new Construct(parent, id),
          ),
        )
        .build(scope, "sys");

      expect(serverBuild.mock.calls[0][2]).toEqual({
        db: { connection: "pg://localhost" },
      });
    });
  });

  describe("afterBuild", () => {
    it("invokes the hook after all components are built", () => {
      const hookFn = vi.fn();
      const scope = createScope();

      compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: [], b: ["a"] })
        .afterBuild(hookFn)
        .build(scope, "test");

      expect(hookFn).toHaveBeenCalledOnce();
    });

    it("passes scope, id, build results, and component scopes to the hook", () => {
      const hookFn = vi.fn();
      const scope = createScope();

      compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: [], b: ["a"] })
        .afterBuild(hookFn)
        .build(scope, "sys");

      expect(hookFn).toHaveBeenCalledWith(
        scope,
        "sys",
        { a: { x: 1 }, b: { y: 2 } },
        { a: scope, b: scope },
      );
    });

    it("returns the original build results", () => {
      const hookFn = vi.fn();

      const result = compose({ a: stubComponent({ x: 1 }) }, { a: [] })
        .afterBuild(hookFn)
        .build(createScope(), "test");

      expect(result).toEqual({ a: { x: 1 } });
    });

    it("invokes the hook after dependencies are resolved", () => {
      const buildOrder: string[] = [];

      const db: Lifecycle = {
        build: () => {
          buildOrder.push("db");
          return { connection: "pg://localhost" };
        },
      };
      const server: Lifecycle = {
        build: () => {
          buildOrder.push("server");
          return { port: 8080 };
        },
      };

      compose({ db, server }, { db: [], server: ["db"] })
        .afterBuild(() => {
          buildOrder.push("hook");
        })
        .build(createScope(), "app");

      expect(buildOrder).toEqual(["db", "server", "hook"]);
    });

    it("supports chaining multiple afterBuild hooks", () => {
      const order: string[] = [];

      compose({ a: stubComponent({ x: 1 }) }, { a: [] })
        .afterBuild(() => order.push("first"))
        .afterBuild(() => order.push("second"))
        .afterBuild(() => order.push("third"))
        .build(createScope(), "test");

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("chains afterBuild after withStacks", () => {
      const hookFn = vi.fn();
      const customScope = new Construct(undefined as never, "custom");

      compose({ a: stubComponent({ x: 1 }) }, { a: [] })
        .withStacks({ a: customScope })
        .afterBuild(hookFn)
        .build(createScope(), "test");

      expect(hookFn).toHaveBeenCalledOnce();
      expect(hookFn).toHaveBeenCalledWith(
        expect.anything(),
        "test",
        { a: { x: 1 } },
        { a: customScope },
      );
    });

    it("chains afterBuild after withStackStrategy", () => {
      const hookFn = vi.fn<AfterBuildHook<{ a: { x: number }; b: { y: number } }>>();
      const scope = createScope();

      compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: [], b: ["a"] })
        .withStackStrategy(
          groupedStacks(
            (key) => (key === "a" ? "groupA" : "groupB"),
            (parent, id) => new Construct(parent, id),
          ),
        )
        .afterBuild(hookFn)
        .build(scope, "sys");

      expect(hookFn).toHaveBeenCalledOnce();
      const [hookScope, hookId, hookResults, hookComponentScopes] = hookFn.mock.calls[0];
      expect(hookScope).toBe(scope);
      expect(hookId).toBe("sys");
      expect(hookResults).toEqual({ a: { x: 1 }, b: { y: 2 } });
      expect(hookComponentScopes.a).toBeInstanceOf(Construct);
      expect(hookComponentScopes.b).toBeInstanceOf(Construct);
      expect(hookComponentScopes.a).not.toBe(hookComponentScopes.b);
    });

    it("chains multiple afterBuild hooks after withStacks", () => {
      const order: string[] = [];
      const customScope = new Construct(undefined as never, "custom");

      compose({ a: stubComponent({ x: 1 }) }, { a: [] })
        .withStacks({ a: customScope })
        .afterBuild(() => order.push("first"))
        .afterBuild(() => order.push("second"))
        .build(createScope(), "test");

      expect(order).toEqual(["first", "second"]);
    });

    it("respects stack routing when chained with afterBuild", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const customScope = new Construct(undefined as never, "custom");

      compose({ a }, { a: [] })
        .withStacks({ a: customScope })
        .afterBuild(() => {
          // intentionally empty
        })
        .build(createScope(), "test");

      expect(aBuild.mock.calls[0][0]).toBe(customScope);
    });
  });

  describe("nested compose", () => {
    it("propagates parent context into inner components so refs can reach outer siblings", () => {
      const dns: Lifecycle<{ zone: { name: string } }> = {
        build: () => ({ zone: { name: "example.com" } }),
      };

      // Inner component capable of resolving a Ref against its received context.
      interface CertResult {
        certFor: string;
      }
      const certComponent = (zoneRef: Resolvable<{ name: string }>): Lifecycle<CertResult> => ({
        build: (_scope, _id, context) => {
          const zone = resolve(zoneRef, context);
          return { certFor: zone.name };
        },
      });

      const site = compose(
        {
          cert: certComponent(ref<{ zone: { name: string } }>("dns").get("zone")),
        },
        { cert: [] },
      );

      const system = compose({ dns, site }, { dns: [], site: ["dns"] });
      const result = system.build(createScope(), "app");

      expect(result.site.cert).toEqual({ certFor: "example.com" });
    });

    it("inner dep shadows parent context on key collision", () => {
      const outerFoo: Lifecycle<{ from: string }> = {
        build: () => ({ from: "outer" }),
      };
      const innerFoo: Lifecycle<{ from: string }> = {
        build: () => ({ from: "inner" }),
      };
      const reader = spyComponent({ read: true });

      const inner = compose(
        { foo: innerFoo, reader: reader.lifecycle },
        { foo: [], reader: ["foo"] },
      );

      compose({ foo: outerFoo, sub: inner }, { foo: [], sub: ["foo"] }).build(createScope(), "app");

      expect(reader.build.mock.calls[0][2]).toEqual({ foo: { from: "inner" } });
    });

    it("still throws when an inner ref cannot be resolved in either inner deps or parent context", () => {
      const dangling: Lifecycle = {
        build: (_scope, _id, context) => {
          resolve(ref<{ x: number }>("missing"), context);
          return {};
        },
      };

      const inner = compose({ dangling }, { dangling: [] });
      const system = compose({ a: stubComponent({ y: 1 }), sub: inner }, { a: [], sub: ["a"] });

      expect(() => system.build(createScope(), "app")).toThrow(/"missing"/);
    });

    it("propagates parent context through a nested .withStacks()-configured system", () => {
      const dns: Lifecycle<{ zone: { name: string } }> = {
        build: () => ({ zone: { name: "example.com" } }),
      };
      const reader = spyComponent({ ok: true });
      const siteStack = new Construct(undefined as never, "siteStack");

      const site = compose({ reader: reader.lifecycle }, { reader: [] }).withStacks({
        reader: siteStack,
      });

      compose({ dns, site }, { dns: [], site: ["dns"] }).build(createScope(), "app");

      expect(reader.build.mock.calls[0][0]).toBe(siteStack);
      expect(reader.build.mock.calls[0][2]).toEqual({
        dns: { zone: { name: "example.com" } },
      });
    });
  });

  describe("componentScopes", () => {
    it("maps every component to the base scope when no stack routing is used", () => {
      const hookFn = vi.fn<AfterBuildHook<{ a: { x: number }; b: { y: number } }>>();
      const scope = createScope();

      compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: [], b: ["a"] })
        .afterBuild(hookFn)
        .build(scope, "sys");

      const componentScopes = hookFn.mock.calls[0][3];
      expect(componentScopes).toEqual({ a: scope, b: scope });
    });

    it("reflects withStacks routing, falling back to the base scope", () => {
      const hookFn = vi.fn<AfterBuildHook<{ a: { x: number }; b: { y: number } }>>();
      const base = createScope();
      const customA = new Construct(undefined as never, "customA");

      compose({ a: stubComponent({ x: 1 }), b: stubComponent({ y: 2 }) }, { a: [], b: ["a"] })
        .withStacks({ a: customA })
        .afterBuild(hookFn)
        .build(base, "sys");

      const componentScopes = hookFn.mock.calls[0][3];
      expect(componentScopes.a).toBe(customA);
      expect(componentScopes.b).toBe(base);
    });

    it("reflects the scopes produced by a stack strategy", () => {
      const hookFn = vi.fn<AfterBuildHook<{ a: { x: number }; b: { y: number } }>>();
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });
      const scope = createScope();

      compose({ a, b }, { a: [], b: ["a"] })
        .withStackStrategy(
          groupedStacks(
            (key) => (key === "a" ? "groupA" : "groupB"),
            (parent, id) => new Construct(parent, id),
          ),
        )
        .afterBuild(hookFn)
        .build(scope, "sys");

      const componentScopes = hookFn.mock.calls[0][3];
      expect(componentScopes.a).toBe(aBuild.mock.calls[0][0]);
      expect(componentScopes.b).toBe(bBuild.mock.calls[0][0]);
    });
  });
});
