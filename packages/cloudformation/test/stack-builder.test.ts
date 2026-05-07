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
  });

  describe("copy", () => {
    it("returns an independent builder with the same configured props", () => {
      const original = createStackBuilder()
        .description("Original description")
        .terminationProtection(true);

      const copy = original.copy();

      expect(copy.description()).toBe("Original description");
      expect(copy.terminationProtection()).toBe(true);
    });

    it("isolates props mutations between original and copy", () => {
      const original = createStackBuilder().description("Original");
      const copy = original.copy();

      original.description("Mutated original");
      copy.description("Mutated copy");

      expect(original.description()).toBe("Mutated original");
      expect(copy.description()).toBe("Mutated copy");
    });

    it("isolates tag mutations between original and copy", () => {
      const app = new App();
      const original = createStackBuilder().tag("team", "platform");
      const copy = original.copy();

      original.tag("env", "prod");
      copy.tag("env", "test");

      const { stack: originalStack } = original.build(app, "OriginalStack");
      const { stack: copyStack } = copy.build(app, "CopyStack");

      const assembly = app.synth();
      expect(assembly.getStackByName(originalStack.stackName).tags).toEqual({
        team: "platform",
        env: "prod",
      });
      expect(assembly.getStackByName(copyStack.stackName).tags).toEqual({
        team: "platform",
        env: "test",
      });
    });

    it("preserves accumulated tags on the copy", () => {
      const app = new App();
      const original = createStackBuilder().tag("team", "platform").tag("env", "prod");

      const { stack } = original.copy().build(app, "CopiedTaggedStack");

      const assembly = app.synth();
      expect(assembly.getStackByName(stack.stackName).tags).toEqual({
        team: "platform",
        env: "prod",
      });
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
