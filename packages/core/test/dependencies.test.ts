import { describe, it, expect, beforeEach } from "vitest";
import { Construct, type IConstruct } from "constructs";
import { addDependencies, collectConstructs } from "../src/dependencies.js";
import { ref } from "../src/ref.js";

/** A bare construct tree — `core` knows `constructs`, never `aws-cdk-lib`. */
const rootConstruct = (): Construct => new Construct(undefined as never, "root");

const node = (scope: Construct, id: string): Construct => new Construct(scope, id);

function collect(value: unknown): IConstruct[] {
  const out = new Set<IConstruct>();
  collectConstructs(value, out, new WeakSet());
  return [...out];
}

describe("collectConstructs", () => {
  it("ignores primitives and null", () => {
    expect(collect(42)).toEqual([]);
    expect(collect("s")).toEqual([]);
    expect(collect(null)).toEqual([]);
    expect(collect(undefined)).toEqual([]);
  });

  it("finds a top-level construct and does not descend into its node tree", () => {
    const root = rootConstruct();
    const parent = node(root, "Parent");
    node(parent, "Child");

    expect(collect({ parent })).toEqual([parent]);
  });

  it("descends into nested construct maps and arrays", () => {
    const root = rootConstruct();
    const a = node(root, "A");
    const b = node(root, "B");

    expect(collect({ alarms: { a }, list: [b] }).sort()).toEqual([a, b].sort());
  });

  it("ignores plain objects with no constructs", () => {
    expect(collect({ name: "x", nested: { count: 1 } })).toEqual([]);
  });

  it("guards against cycles in plain-object graphs", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;

    expect(collect(cyclic)).toEqual([]);
  });
});

describe("addDependencies", () => {
  let root: Construct;
  let target: Construct;

  beforeEach(() => {
    root = rootConstruct();
    target = node(root, "Target");
  });

  it("orders the target after every construct in a whole-component ref", () => {
    const a = node(root, "A");
    const b = node(root, "B");
    const unnamed = node(root, "Unnamed");

    addDependencies(target, [ref<{ a: Construct; b: Construct }>("component")], {
      component: { a, b },
      other: { unnamed },
    });

    expect(target.node.dependencies).toEqual(expect.arrayContaining([a, b]));
    expect(target.node.dependencies).not.toContain(unnamed);
  });

  it("orders the target after one construct selected out of a sibling", () => {
    const api = node(root, "Api");
    const logGroup = node(root, "LogGroup");

    addDependencies(target, [ref("component", (r: { api: Construct }) => r.api)], {
      component: { api, logGroup },
    });

    expect(target.node.dependencies).toContain(api);
    expect(target.node.dependencies).not.toContain(logGroup);
  });

  it("accepts a concrete construct, with no ref and no context", () => {
    const queue = node(root, "Queue");

    addDependencies(target, [queue], {});

    expect(target.node.dependencies).toContain(queue);
  });

  it("mixes shapes in one call and de-duplicates the result", () => {
    const api = node(root, "Api");

    addDependencies(target, [api, ref("component", (r: { api: Construct }) => r.api)], {
      component: { api },
    });

    expect(target.node.dependencies.filter((d) => d === api)).toHaveLength(1);
  });
});
