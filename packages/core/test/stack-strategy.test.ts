import { describe, it, expect, vi } from "vitest";
import { Construct } from "constructs";
import { at } from "../src/build-id.js";
import { type Lifecycle } from "../src/lifecycle.js";
import { BUILD_SCOPE, groupedStacks, singleStack } from "../src/stack-strategy.js";

function createScope(id = "root"): Construct {
  return new Construct(undefined as never, id);
}

/** A stack source that builds a plain construct, standing in for a stack builder. */
function spySource() {
  const build = vi.fn((parent: Construct, id: string) => ({ stack: new Construct(parent, id) }));
  return { source: { build } as Lifecycle<{ stack: Construct }>, build };
}

describe("singleStack", () => {
  it("builds a Lifecycle source once, under the system id, for every key", () => {
    const { source, build } = spySource();
    const scope = createScope();

    const placement = singleStack(source).place(scope, "sys", ["a", "b"]);

    expect(build).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledWith(scope, "sys");
    expect(placement.a).toBe(placement.b);
    expect(placement.a.node.id).toBe("sys");
  });

  it("uses a built stack as it is", () => {
    const stack = createScope("stack");

    expect(singleStack(stack).place(createScope(), "sys", ["a"])).toEqual({ a: stack });
  });

  it("places every key in the scope passed to build for BUILD_SCOPE", () => {
    const scope = createScope();

    expect(singleStack(BUILD_SCOPE).place(scope, "sys", ["a", "b"])).toEqual({
      a: scope,
      b: scope,
    });
  });
});

describe("groupedStacks", () => {
  it("builds each group's Lifecycle source once, under systemId-group", () => {
    const service = spySource();
    const data = spySource();
    const scope = createScope();

    const placement = groupedStacks(
      { service: service.source, data: data.source },
      { handler: "service", api: "service", table: "data" },
    ).place(scope, "sys", ["handler", "api", "table"]);

    expect(service.build).toHaveBeenCalledOnce();
    expect(service.build).toHaveBeenCalledWith(scope, "sys-service");
    expect(data.build).toHaveBeenCalledWith(scope, "sys-data");
    expect(placement.handler).toBe(placement.api);
    expect(placement.table).not.toBe(placement.handler);
  });

  it("mixes built stacks, builders and BUILD_SCOPE across groups", () => {
    const viewer = createScope("viewer");
    const scope = createScope();

    const placement = groupedStacks(
      { core: spySource().source, viewer, local: BUILD_SCOPE },
      { ingest: "core", ui: "viewer", alarms: "local" },
    ).place(scope, "sys", ["ingest", "ui", "alarms"]);

    expect(placement.ui).toBe(viewer);
    expect(placement.alarms).toBe(scope);
    expect(placement.ingest.node.id).toBe("sys-core");
  });

  it("builds only the groups some component is placed in", () => {
    const unused = spySource();

    groupedStacks({ used: spySource().source, unused: unused.source }, { a: "used" }).place(
      createScope(),
      "sys",
      ["a"],
    );

    expect(unused.build).not.toHaveBeenCalled();
  });

  it("builds an at()-pinned group under its pin", () => {
    const { source, build } = spySource();

    groupedStacks({ core: at("Factory-Core", source) }, { a: "core" }).place(createScope(), "sys", [
      "a",
    ]);

    expect(build.mock.calls[0][1]).toBe("Factory-Core");
  });

  it("leaves a key unplaced when its group has no source, for compose() to report", () => {
    const scope = createScope();

    expect(
      groupedStacks({ core: BUILD_SCOPE }, { a: "core", b: "missing" } as never).place(
        scope,
        "sys",
        ["a", "b"],
      ),
    ).toEqual({ a: scope });
  });

  it("answers for the keys in its placement, so compose() can report stale and missing ones", () => {
    const scope = createScope();

    expect(
      groupedStacks({ core: BUILD_SCOPE }, { a: "core", stale: "core" }).place(scope, "sys", [
        "a",
        "b",
      ] as never),
    ).toEqual({ a: scope, stale: scope });
  });

  it("rejects, when compiling, a placement in a group that does not exist", () => {
    // @ts-expect-error -- "missing" is not a group
    groupedStacks({ core: BUILD_SCOPE }, { a: "missing" });
  });
});
