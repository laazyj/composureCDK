import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { PolicyDocument, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { applyBuilderTags } from "../src/apply-builder-tags.js";

interface CfnTagEntry {
  Key: string;
  Value: string;
}

interface CfnResourceWithTags {
  Properties?: { Tags?: CfnTagEntry[] };
}

function tagsOnResource(resource: CfnResourceWithTags | undefined): CfnTagEntry[] {
  return resource?.Properties?.Tags ?? [];
}

describe("applyBuilderTags", () => {
  it("is a no-op when the tag map is empty", () => {
    const stack = new Stack(new App(), "TestStack");
    const bucket = new Bucket(stack, "B");
    applyBuilderTags({ bucket }, new Map());

    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    expect(Object.values(buckets)[0]?.Properties?.Tags).toBeUndefined();
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
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    const topics = template.findResources("AWS::SNS::Topic") as Record<string, CfnResourceWithTags>;
    const expectedTags = [
      { Key: "Owner", Value: "platform" },
      { Key: "Project", Value: "rig" },
    ];
    expect(tagsOnResource(Object.values(buckets)[0])).toEqual(expect.arrayContaining(expectedTags));
    expect(tagsOnResource(Object.values(topics)[0])).toEqual(expect.arrayContaining(expectedTags));
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
    const topics = template.findResources("AWS::SNS::Topic") as Record<string, CfnResourceWithTags>;
    const tagged = Object.values(topics).filter((r) =>
      tagsOnResource(r).some((t) => t.Key === "CostCenter" && t.Value === "1234"),
    );
    expect(tagged).toHaveLength(2);
  });

  it("does not recurse into wrapper objects (one level deep only)", () => {
    const stack = new Stack(new App(), "TestStack");
    const wrappedTopic = new Topic(stack, "Wrapped");
    const directTopic = new Topic(stack, "Direct");

    // The wrapper objects nest a construct inside `.inner`. The walker
    // must not reach it; only the directly-attached topic is tagged.
    const result = {
      direct: directTopic,
      wrappers: {
        only: { inner: wrappedTopic, label: "x" },
      },
    };

    applyBuilderTags(result, new Map([["Owner", "platform"]]));

    const template = Template.fromStack(stack);
    const topics = template.findResources("AWS::SNS::Topic") as Record<string, CfnResourceWithTags>;
    const taggedNames = Object.entries(topics)
      .filter(([, r]) => tagsOnResource(r).some((t) => t.Key === "Owner"))
      .map(([key]) => key);
    expect(taggedNames).toHaveLength(1);
    expect(taggedNames[0]).toMatch(/Direct/);
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
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    expect(tagsOnResource(Object.values(buckets)[0])).toEqual(
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
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    expect(tagsOnResource(Object.values(buckets)[0])).toEqual(
      expect.arrayContaining([{ Key: "Owner", Value: "platform" }]),
    );
  });
});
