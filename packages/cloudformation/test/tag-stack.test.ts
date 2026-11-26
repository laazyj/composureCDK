import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { createStackBuilder } from "../src/stack-builder.js";
import { tagStack } from "../src/tag-stack.js";

/** A stand-in for a deployment framework's own Stack subclass. */
class FrameworkStack extends Stack {}

function synthStack(app: App, stack: Stack) {
  const artifact = app.synth().getStackByName(stack.stackName);
  return { stackTags: artifact.tags, template: artifact.template as object };
}

describe("tagStack", () => {
  for (const explicitStackTags of [true, false]) {
    describe(`with explicitStackTags ${String(explicitStackTags)}`, () => {
      const context = { "@aws-cdk/core:explicitStackTags": explicitStackTags };

      it("tags the stack and each resource in it, as the stack builder does", () => {
        const tags = { team: "platform", app: "MyApp" };

        const builtApp = new App({ context });
        const { stack: built } = createStackBuilder().tags(tags).build(builtApp, "S");
        new Bucket(built, "B");

        const heldApp = new App({ context });
        const held = new FrameworkStack(heldApp, "S");
        new Bucket(held, "B");
        tagStack(held, tags);

        const expected = synthStack(builtApp, built);
        expect(expected.stackTags).toEqual(tags);
        expect(synthStack(heldApp, held)).toEqual(expected);
      });
    });
  }

  it("throws on an invalid tag before applying any", () => {
    const app = new App();
    const stack = new Stack(app, "S");

    expect(() => {
      tagStack(stack, { team: "platform", "aws:reserved": "x" });
    }).toThrow(/reserved "aws:" prefix/);
    expect(app.synth().getStackByName("S").tags).toEqual({});
  });
});
