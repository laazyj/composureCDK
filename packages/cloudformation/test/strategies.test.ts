import { describe, it, expect, vi } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { singleStack, groupedStacks } from "../src/strategies.js";

describe("singleStack", () => {
  it("creates a CDK Stack by default", () => {
    const strategy = singleStack();
    const app = new App();

    const result = strategy.resolve(app, "sys", "a");

    expect(result).toBeInstanceOf(Stack);
  });

  it("reuses the same Stack for all components", () => {
    const strategy = singleStack();
    const app = new App();

    const scopeA = strategy.resolve(app, "sys", "a");
    const scopeB = strategy.resolve(app, "sys", "b");

    expect(scopeA).toBe(scopeB);
  });

  it("uses a custom factory when provided", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const strategy = singleStack(factory);
    const app = new App();

    strategy.resolve(app, "sys", "a");

    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(app, "sys");
  });
});

describe("groupedStacks", () => {
  it("creates CDK Stacks by default", () => {
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify);
    const app = new App();

    const serviceScope = strategy.resolve(app, "sys", "handler");
    const persistenceScope = strategy.resolve(app, "sys", "table");

    expect(serviceScope).toBeInstanceOf(Stack);
    expect(persistenceScope).toBeInstanceOf(Stack);
    expect(serviceScope).not.toBe(persistenceScope);
  });

  it("reuses Stacks for components in the same group", () => {
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify);
    const app = new App();

    const handlerScope = strategy.resolve(app, "sys", "handler");
    const apiScope = strategy.resolve(app, "sys", "api");

    expect(handlerScope).toBe(apiScope);
  });

  it("uses a custom factory when provided", () => {
    const factory = vi.fn((scope: Construct, id: string) => new Construct(scope, id));
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify, factory);
    const app = new App();

    strategy.resolve(app, "sys", "handler");
    strategy.resolve(app, "sys", "table");

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
