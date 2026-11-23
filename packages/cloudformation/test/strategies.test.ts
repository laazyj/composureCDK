/* eslint-disable @typescript-eslint/no-deprecated -- these tests pin the deprecated wrappers until they are removed (ADR-0023) */
import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { singleStack, groupedStacks } from "../src/strategies.js";
import { createStackBuilder } from "../src/stack-builder.js";

describe("singleStack (deprecated)", () => {
  it("creates one CDK Stack by default, shared by every component", () => {
    const placement = singleStack().place(new App(), "sys", ["a", "b"]);

    expect(placement.a).toBeInstanceOf(Stack);
    expect(placement.a).toBe(placement.b);
  });

  it("uses a configured builder when provided", () => {
    const builder = createStackBuilder().description("Configured by test");

    const { a } = singleStack(builder).place(new App(), "sys", ["a"]);

    expect((a as Stack).templateOptions.description).toBe("Configured by test");
  });

  it("applies tags from the supplied builder to the resulting Stack", () => {
    const app = new App();

    singleStack(createStackBuilder().tag("team", "platform")).place(app, "TaggedSys", ["a"]);

    expect(app.synth().getStackByName("TaggedSys").tags).toEqual({ team: "platform" });
  });

  it("snapshots configuration when handed builder.copy()", () => {
    const base = createStackBuilder().tag("team", "platform");
    const strategy = singleStack(base.copy());
    base.tag("env", "leaked");
    const app = new App();

    strategy.place(app, "SnapshotSys", ["a"]);

    expect(app.synth().getStackByName("SnapshotSys").tags).toEqual({ team: "platform" });
  });
});

describe("groupedStacks (deprecated)", () => {
  const classify = (key: string) => (key === "table" ? "persistence" : "service");

  it("creates one CDK Stack per group by default", () => {
    const placement = groupedStacks(classify).place(new App(), "sys", ["handler", "api", "table"]);

    expect(placement.handler).toBeInstanceOf(Stack);
    expect(placement.handler).toBe(placement.api);
    expect(placement.table).not.toBe(placement.handler);
    expect(placement.table.node.id).toBe("sys-persistence");
  });

  it("builds every group from the configured builder", () => {
    const app = new App();

    groupedStacks(classify, createStackBuilder().tag("team", "platform")).place(app, "Sys", [
      "handler",
      "table",
    ]);

    const assembly = app.synth();
    expect(assembly.getStackByName("Sys-service").tags).toEqual({ team: "platform" });
    expect(assembly.getStackByName("Sys-persistence").tags).toEqual({ team: "platform" });
  });

  it("snapshots configuration when handed builder.copy()", () => {
    const base = createStackBuilder().tag("team", "platform");
    const strategy = groupedStacks(classify, base.copy());
    base.tag("env", "leaked");
    const app = new App();

    strategy.place(app, "Sys", ["handler"]);

    expect(app.synth().getStackByName("Sys-service").tags).toEqual({ team: "platform" });
  });
});
