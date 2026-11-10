import { describe, it, expect, vi } from "vitest";
import { Construct, RootConstruct, type IConstruct } from "constructs";
import { at } from "../src/build-id.js";
import { compose } from "../src/compose.js";
import { DuplicateConstructIdError } from "../src/duplicate-construct-id-error.js";
import { type Lifecycle } from "../src/lifecycle.js";
import { scoped } from "../src/scoped.js";

/** A component that creates one construct, as every real builder does. */
function resource(): Lifecycle<{ construct: IConstruct; context?: Record<string, object> }> {
  return {
    build: (scope, id, context) => ({ construct: new Construct(scope, id), context }),
  };
}

const pathOf = (r: { construct: IConstruct }) => r.construct.node.path;

describe("scoped", () => {
  it("builds the system under a construct of its own, with each component at its key", () => {
    const root = new RootConstruct();
    const result = scoped(
      compose({ bucket: resource(), queue: resource() }, { bucket: [], queue: [] }),
    ).build(root, "Failures");

    expect(pathOf(result.bucket)).toBe("Failures/bucket");
    expect(pathOf(result.queue)).toBe("Failures/queue");
  });

  it("nests under the id its parent compose() derives for it", () => {
    const root = new RootConstruct();
    const result = compose(
      {
        orders: resource(),
        failures: scoped(compose({ bucket: resource() }, { bucket: [] })),
      },
      { orders: [], failures: [] },
    ).build(root, "App");

    expect(pathOf(result.orders)).toBe("App--orders");
    expect(pathOf(result.failures.bucket)).toBe("App--failures/bucket");
  });

  it("lets an at()-pinned id inside the system win over its key", () => {
    const root = new RootConstruct();
    const result = scoped(
      compose({ bucket: at("Archive", resource()), queue: resource() }, { bucket: [], queue: [] }),
    ).build(root, "Failures");

    expect(pathOf(result.bucket)).toBe("Failures/Archive");
    expect(pathOf(result.queue)).toBe("Failures/queue");
  });

  it("still throws DuplicateConstructIdError when a pinned id collides with a key", () => {
    const root = new RootConstruct();
    const system = scoped(
      compose({ bucket: resource(), queue: at("bucket", resource()) }, { bucket: [], queue: [] }),
    );

    expect(() => system.build(root, "Failures")).toThrow(DuplicateConstructIdError);
  });

  it("passes the parent context through to the system's components", () => {
    const root = new RootConstruct();
    const result = compose(
      {
        orders: resource(),
        consumer: scoped(compose({ processor: resource() }, { processor: [] })),
      },
      { orders: [], consumer: ["orders"] },
    ).build(root, "App");

    expect(result.consumer.processor.context?.orders).toBe(result.orders);
  });

  it("gives afterBuild hooks on the system the new construct as their scope", () => {
    const root = new RootConstruct();
    const hook = vi.fn();
    scoped(compose({ bucket: resource() }, { bucket: [] }).afterBuild(hook)).build(
      root,
      "Failures",
    );

    const [scope, id, , componentScopes] = hook.mock.calls[0] as [
      IConstruct,
      string,
      unknown,
      Record<string, IConstruct>,
    ];
    expect(scope.node.path).toBe("Failures");
    expect(id).toBe("Failures");
    expect(componentScopes.bucket).toBe(scope);
  });

  it("keeps the prefixed id for a component routed out of the new construct", () => {
    const root = new RootConstruct();
    const other = new Construct(root, "Other");
    const result = scoped(
      compose({ bucket: resource(), queue: resource() }, { bucket: [], queue: [] }).withStacks({
        queue: other,
      }),
    ).build(root, "Failures");

    expect(pathOf(result.bucket)).toBe("Failures/bucket");
    expect(pathOf(result.queue)).toBe("Other/Failures--queue");
  });

  it("hands a stack strategy the new construct as its parent scope", () => {
    const root = new RootConstruct();
    const resolve = vi.fn((scope: IConstruct) => scope);
    const result = scoped(
      compose({ bucket: resource() }, { bucket: [] }).withStackStrategy({ resolve }),
    ).build(root, "Failures");

    expect(resolve).toHaveBeenCalledWith(result.bucket.construct.node.scope, "Failures", "bucket");
    expect(pathOf(result.bucket)).toBe("Failures/bucket");
  });

  it("builds plainly as before when the system is not wrapped", () => {
    const root = new RootConstruct();
    const result = compose({ bucket: resource() }, { bucket: [] }).build(root, "Failures");

    expect(pathOf(result.bucket)).toBe("Failures--bucket");
  });

  it("rejects a component that is not a compose() system", () => {
    expect(() => scoped(resource() as never)).toThrow(TypeError);
  });
});
