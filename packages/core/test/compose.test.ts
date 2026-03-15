import { describe, it, expect, vi } from "vitest";
import { Construct } from "constructs";
import { compose } from "../src/compose.js";
import { CyclicDependencyError } from "../src/cyclic-dependency-error.js";
import { type Lifecycle } from "../src/lifecycle.js";

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
      system.build(scope, "test", {});

      expect(build.mock.calls[0][0]).toBe(scope);
    });

    it("passes a scoped id to each component", () => {
      const { lifecycle: a, build: aBuild } = spyComponent({ x: 1 });
      const { lifecycle: b, build: bBuild } = spyComponent({ y: 2 });

      const system = compose({ a, b }, { a: [], b: ["a"] });
      system.build(createScope(), "myapp", {});

      expect(aBuild.mock.calls[0][1]).toBe("myapp/a");
      expect(bBuild.mock.calls[0][1]).toBe("myapp/b");
    });
  });
});
