import { describe, expect, it } from "vitest";
import type { IConstruct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { buildFixture } from "../src/build-fixture.js";
import { testEnv } from "../src/env.js";

interface FakeResult {
  readonly bucket: Bucket;
  readonly context: Record<string, object> | undefined;
  readonly versioned: boolean;
}

/** Stands in for a builder: records what it was configured and built with. */
function createFakeBuilder() {
  let versioned = false;
  return {
    versioned(value: boolean) {
      versioned = value;
      return this;
    },
    build(scope: IConstruct, id: string, context?: Record<string, object>): FakeResult {
      return { bucket: new Bucket(scope, id, { versioned }), context, versioned };
    },
  };
}

describe("buildFixture", () => {
  const buildAndSynth = buildFixture(createFakeBuilder, "TestBucket");

  it("builds under the bound id and returns the synthesised template", () => {
    const { template, result } = buildAndSynth();

    expect(result.bucket.node.id).toBe("TestBucket");
    template.resourceCountIs("AWS::S3::Bucket", 1);
  });

  it("applies the configure callback before building", () => {
    const { template } = buildAndSynth((b) => b.versioned(true));

    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  it("gives each call its own stack, so tests cannot leak into each other", () => {
    expect(buildAndSynth().stack).not.toBe(buildAndSynth().stack);
  });

  it("passes the stack to the configure callback, for a suite that needs the scope", () => {
    const { template } = buildAndSynth((_b, stack) => {
      new Topic(stack, "Sibling");
    });

    template.resourceCountIs("AWS::SNS::Topic", 1);
  });

  it("passes the stack to the factory, for a builder seeded from a construct in it", () => {
    const seeded = buildFixture((stack) => {
      new Topic(stack, "Seed");
      return createFakeBuilder();
    }, "TestBucket");

    seeded().template.resourceCountIs("AWS::SNS::Topic", 1);
  });

  it("forwards context as build's third argument", () => {
    const context = { dep: { ref: "value" } };

    expect(buildAndSynth(undefined, { context }).result.context).toEqual(context);
  });

  describe("stack props", () => {
    const inUsEast1 = buildFixture(createFakeBuilder, "TestBucket", {
      stackProps: { env: testEnv("us-east-1") },
    });

    it("applies the fixture's defaults to every call", () => {
      expect(inUsEast1().stack.region).toBe("us-east-1");
    });

    it("lets a call replace them — `{}` gives an environment-agnostic stack", () => {
      expect(inUsEast1(undefined, { stackProps: {} }).stack.region).not.toBe("us-east-1");
    });

    it("lets a call substitute a different environment", () => {
      const { stack } = inUsEast1(undefined, { stackProps: { env: testEnv("eu-west-2") } });

      expect(stack.region).toBe("eu-west-2");
    });
  });
});
