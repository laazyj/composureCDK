import { describe, it, expect } from "vitest";
import { App, Stack, Tags } from "aws-cdk-lib";
import { createStackBuilder } from "../src/stack-builder.js";

describe("StackBuilder", () => {
  describe("build", () => {
    it("creates a Stack with the given id", () => {
      const app = new App();

      const { stack } = createStackBuilder().build(app, "TestStack");

      expect(stack).toBeInstanceOf(Stack);
      expect(stack.stackName).toBe("TestStack");
    });

    it("applies configured description", () => {
      const app = new App();

      const { stack } = createStackBuilder().description("My description").build(app, "TestStack");

      expect(stack.templateOptions.description).toBe("My description");
    });

    it("applies termination protection", () => {
      const app = new App();

      const { stack } = createStackBuilder().terminationProtection(true).build(app, "TestStack");

      expect(stack.terminationProtection).toBe(true);
    });

    it("reads configured props via getter", () => {
      const builder = createStackBuilder().description("desc").terminationProtection(true);

      expect(builder.description()).toBe("desc");
      expect(builder.terminationProtection()).toBe(true);
    });
  });

  describe("tag", () => {
    it("applies tags to the stack", () => {
      const app = new App();

      const { stack } = createStackBuilder()
        .tag("team", "platform")
        .tag("env", "test")
        .build(app, "TaggedStack");

      const tags = Tags.of(stack);
      expect(tags).toBeDefined();
      // Verify tags are applied by synthesizing
      const assembly = app.synth();
      const stackArtifact = assembly.getStackByName("TaggedStack");
      expect(stackArtifact.tags).toEqual({ team: "platform", env: "test" });
    });

    it("returns the builder for chaining", () => {
      const builder = createStackBuilder();

      const returned = builder.tag("key", "value");

      expect(returned).toBe(builder);
    });

    it("applies multiple tags via .tags({...}) shorthand", () => {
      const app = new App();

      const { stack } = createStackBuilder()
        .tags({ team: "platform", env: "prod" })
        .build(app, "TaggedStack");

      const assembly = app.synth();
      const stackArtifact = assembly.getStackByName("TaggedStack");
      expect(stackArtifact.tags).toEqual({ team: "platform", env: "prod" });
      expect(stack.stackName).toBe("TaggedStack");
    });

    it("validates tag keys at call time", () => {
      const builder = createStackBuilder();
      expect(() => builder.tag("aws:reserved", "x")).toThrow(/aws:/);
      expect(() => builder.tag("", "x")).toThrow(/non-empty/);
    });
  });

  describe("toScopeFactory", () => {
    it("returns a factory that creates Stacks with configured props", () => {
      const factory = createStackBuilder()
        .description("Factory stack")
        .terminationProtection(true)
        .toScopeFactory();

      const app = new App();
      const scope = factory(app, "FactoryStack");

      expect(scope).toBeInstanceOf(Stack);
      const stack = scope as Stack;
      expect(stack.templateOptions.description).toBe("Factory stack");
      expect(stack.terminationProtection).toBe(true);
    });

    it("returns a factory that applies tags", () => {
      const factory = createStackBuilder().tag("team", "platform").toScopeFactory();

      const app = new App();
      factory(app, "TaggedFactoryStack");

      const assembly = app.synth();
      const stackArtifact = assembly.getStackByName("TaggedFactoryStack");
      expect(stackArtifact.tags).toEqual({ team: "platform" });
    });

    it("creates independent stacks on each call", () => {
      const factory = createStackBuilder().description("Shared config").toScopeFactory();

      const app = new App();
      const stack1 = factory(app, "Stack1");
      const stack2 = factory(app, "Stack2");

      expect(stack1).not.toBe(stack2);
      expect(stack1).toBeInstanceOf(Stack);
      expect(stack2).toBeInstanceOf(Stack);
    });
  });

  describe("fluent API", () => {
    it("supports chaining prop setters", () => {
      const app = new App();

      const { stack } = createStackBuilder()
        .description("Chained")
        .terminationProtection(true)
        .tag("env", "prod")
        .build(app, "ChainedStack");

      expect(stack.templateOptions.description).toBe("Chained");
      expect(stack.terminationProtection).toBe(true);
    });
  });
});
