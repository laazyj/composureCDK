import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { PolicyDocument, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { tagsPerResource } from "@composurecdk/cdk-testing";
import { applyBuilderTags } from "../src/apply-builder-tags.js";

describe("applyBuilderTags", () => {
  it("is a no-op when the tag map is empty", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "B");
    applyBuilderTags({ bucket }, new Map());

    // Exactly one bucket, carrying no tags. The loop-and-assert form this
    // replaces passed vacuously when no bucket matched.
    expect(tagsPerResource(Template.fromStack(stack), "AWS::S3::Bucket")).toEqual([[]]);
  });

  it("tags top-level IConstruct fields", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "B");
    const topic = new Topic(stack, "T");

    applyBuilderTags(
      { bucket, topic },
      new Map([
        ["Owner", "platform"],
        ["Project", "rig"],
      ]),
    );

    const template = Template.fromStack(stack);
    const expectedTags = [
      { Key: "Owner", Value: "platform" },
      { Key: "Project", Value: "rig" },
    ];
    expect(tagsPerResource(template, "AWS::S3::Bucket")[0]).toEqual(
      expect.arrayContaining(expectedTags),
    );
    expect(tagsPerResource(template, "AWS::SNS::Topic")[0]).toEqual(
      expect.arrayContaining(expectedTags),
    );
  });

  it("tags constructs nested one level inside Record-typed fields", () => {
    const stack = new Stack(new App(), "TestStack");
    const result = {
      primary: new Bucket(stack, "Primary"),
      siblings: {
        a: new Topic(stack, "A"),
        b: new Topic(stack, "B"),
      },
    };

    applyBuilderTags(result, new Map([["CostCenter", "1234"]]));

    const template = Template.fromStack(stack);
    const tagged = tagsPerResource(template, "AWS::SNS::Topic").filter((tags) =>
      tags.some((t) => t.Key === "CostCenter" && t.Value === "1234"),
    );
    expect(tagged).toHaveLength(2);
  });

  it("recurses through wrapper objects to tag nested constructs", () => {
    const stack = new Stack(new App(), "TestStack");
    const wrappedTopic = new Topic(stack, "Wrapped");
    const directTopic = new Topic(stack, "Direct");

    // The wrapper bundles a construct alongside metadata. The walker
    // descends into plain-object literals, so both topics are tagged
    // and the metadata fields are skipped (not constructs).
    const result = {
      direct: directTopic,
      wrappers: {
        only: { inner: wrappedTopic, label: "x" },
      },
    };

    applyBuilderTags(result, new Map([["Owner", "platform"]]));

    const template = Template.fromStack(stack);
    const taggedNames = Object.keys(
      template.findResources("AWS::SNS::Topic", {
        Properties: { Tags: Match.arrayWith([Match.objectLike({ Key: "Owner" })]) },
      }),
    );
    expect(taggedNames).toHaveLength(2);
    expect(taggedNames.some((n) => n.includes("Direct"))).toBe(true);
    expect(taggedNames.some((n) => n.includes("Wrapped"))).toBe(true);
  });

  it("skips CDK core objects that are not constructs (PolicyDocument)", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "B");
    const inlinePolicy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:GetObject"],
          resources: ["*"],
        }),
      ],
    });

    // Should not throw and should leave the PolicyDocument untouched.
    expect(() => {
      applyBuilderTags({ bucket, inlinePolicy }, new Map([["Owner", "platform"]]));
    }).not.toThrow();

    // The bucket received the tag; the document is unaffected (PolicyDocument
    // exposes no public tag API — verifying via construct identity is enough).
    const template = Template.fromStack(stack);
    expect(tagsPerResource(template, "AWS::S3::Bucket")[0]).toEqual(
      expect.arrayContaining([{ Key: "Owner", Value: "platform" }]),
    );
  });

  it("skips primitive-valued fields without enumerating them", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "B");
    const result = {
      bucket,
      label: "literal",
      count: 3,
      flags: true,
      empty: null,
      missing: undefined,
    };

    expect(() => {
      applyBuilderTags(result, new Map([["Owner", "platform"]]));
    }).not.toThrow();

    const template = Template.fromStack(stack);
    expect(tagsPerResource(template, "AWS::S3::Bucket")[0]).toEqual(
      expect.arrayContaining([{ Key: "Owner", Value: "platform" }]),
    );
  });

  it("descends into Object.create(null) dictionaries", () => {
    const stack = new Stack(new App(), "TestStack");
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");

    // Builder authors may use Object.create(null) for Record fields whose keys
    // come from user input — the prototype is null, not Object.prototype.
    const nullProtoMap = Object.create(null) as Record<string, Topic>;
    nullProtoMap.first = a;
    nullProtoMap.second = b;

    applyBuilderTags({ alarms: nullProtoMap }, new Map([["Owner", "platform"]]));

    const template = Template.fromStack(stack);
    const tagged = tagsPerResource(template, "AWS::SNS::Topic").filter((tags) =>
      tags.some((t) => t.Key === "Owner" && t.Value === "platform"),
    );
    expect(tagged).toHaveLength(2);
  });
});
