import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import type { Lifecycle } from "@composurecdk/core";
import { singleStack, groupedStacks } from "../src/strategies.js";
import { createStackBuilder, type StackBuilderResult } from "../src/stack-builder.js";

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

  it("uses a configured builder when provided", () => {
    const builder = createStackBuilder().description("Configured by test");
    const strategy = singleStack(builder);
    const app = new App();

    const stack = strategy.resolve(app, "sys", "a") as Stack;

    expect(stack.templateOptions.description).toBe("Configured by test");
  });

  it("applies tags from the supplied builder to the resulting Stack", () => {
    const builder = createStackBuilder().tag("team", "platform");
    const strategy = singleStack(builder);
    const app = new App();

    strategy.resolve(app, "TaggedSys", "a");

    const assembly = app.synth();
    expect(assembly.getStackByName("TaggedSys").tags).toEqual({ team: "platform" });
  });

  it("isolates default-builder state across separate strategy invocations", () => {
    const strategyA = singleStack();
    const strategyB = singleStack();

    const appA = new App();
    const appB = new App();

    strategyA.resolve(appA, "SysA", "a");
    strategyB.resolve(appB, "SysB", "b");

    expect(appA.synth().getStackByName("SysA").tags).toEqual({});
    expect(appB.synth().getStackByName("SysB").tags).toEqual({});
  });

  it("snapshots configuration when handed builder.copy()", () => {
    const base = createStackBuilder().tag("team", "platform");
    const strategy = singleStack(base.copy());

    base.tag("env", "leaked");

    const app = new App();
    strategy.resolve(app, "SnapshotSys", "a");

    const assembly = app.synth();
    expect(assembly.getStackByName("SnapshotSys").tags).toEqual({ team: "platform" });
  });

  it("accepts any Lifecycle<StackBuilderResult>", () => {
    const app = new App();
    const stub: Lifecycle<StackBuilderResult> = {
      build: (scope, id) => ({ stack: new Stack(scope, id, { description: "from stub" }) }),
    };

    const strategy = singleStack(stub);
    const stack = strategy.resolve(app, "StubSys", "a") as Stack;

    expect(stack.templateOptions.description).toBe("from stub");
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

  it("uses a configured builder when provided", () => {
    const builder = createStackBuilder().tag("team", "platform");
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify, builder);
    const app = new App();

    strategy.resolve(app, "Sys", "handler");
    strategy.resolve(app, "Sys", "table");

    const assembly = app.synth();
    expect(assembly.getStackByName("Sys-service").tags).toEqual({ team: "platform" });
    expect(assembly.getStackByName("Sys-persistence").tags).toEqual({ team: "platform" });
  });

  it("snapshots configuration when handed builder.copy()", () => {
    const base = createStackBuilder().tag("team", "platform");
    const classify = (key: string) => (key === "table" ? "persistence" : "service");
    const strategy = groupedStacks(classify, base.copy());

    base.tag("env", "leaked");

    const app = new App();
    strategy.resolve(app, "Sys", "handler");

    const assembly = app.synth();
    expect(assembly.getStackByName("Sys-service").tags).toEqual({ team: "platform" });
  });
});
