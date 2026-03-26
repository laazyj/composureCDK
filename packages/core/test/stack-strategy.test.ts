import { describe, it, expect, vi } from "vitest";
import { Construct } from "constructs";
import { singleStack, groupedStacks } from "../src/stack-strategy.js";

function createScope(id = "root"): Construct {
  return new Construct(undefined as never, id);
}

describe("singleStack", () => {
  it("creates a scope via the factory on first resolve", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const strategy = singleStack(factory);
    const scope = createScope();

    strategy.resolve(scope, "sys", "a");

    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(scope, "sys");
  });

  it("reuses the same scope for all components", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const strategy = singleStack(factory);
    const scope = createScope();

    const scopeA = strategy.resolve(scope, "sys", "a");
    const scopeB = strategy.resolve(scope, "sys", "b");

    expect(scopeA).toBe(scopeB);
    expect(factory).toHaveBeenCalledOnce();
  });
});

describe("groupedStacks", () => {
  it("creates a scope per group via the factory", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify, factory);
    const scope = createScope();

    strategy.resolve(scope, "sys", "handler");
    strategy.resolve(scope, "sys", "table");

    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith(scope, "sys-service");
    expect(factory).toHaveBeenCalledWith(scope, "sys-persistence");
  });

  it("reuses scopes for components in the same group", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify, factory);
    const scope = createScope();

    const handlerScope = strategy.resolve(scope, "sys", "handler");
    const apiScope = strategy.resolve(scope, "sys", "api");
    const tableScope = strategy.resolve(scope, "sys", "table");

    expect(handlerScope).toBe(apiScope);
    expect(tableScope).not.toBe(handlerScope);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
