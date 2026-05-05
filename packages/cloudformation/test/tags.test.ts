import { describe, it, expect } from "vitest";
import { App, Stack, Tags } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";
import { compose, type Lifecycle } from "@composurecdk/core";
import { tags } from "../src/tags.js";

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

function bucketComponent(): Lifecycle<{ bucket: Bucket }> {
  return {
    build: (scope: IConstruct, id: string) => ({
      bucket: new Bucket(scope, id),
    }),
  };
}

function topicComponent(): Lifecycle<{ topic: Topic }> {
  return {
    build: (scope: IConstruct, id: string) => ({
      topic: new Topic(scope, id),
    }),
  };
}

describe("tags() afterBuild helper", () => {
  it("applies `system` tags to every construct under the top-level scope", () => {
    const stack = new Stack(new App(), "TestStack");

    compose(
      { primary: bucketComponent(), notifier: topicComponent() },
      { primary: [], notifier: [] },
    )
      .afterBuild(
        tags({
          system: { Owner: "platform", Environment: "prod" },
        }),
      )
      .build(stack, "MySystem");

    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    const topics = template.findResources("AWS::SNS::Topic") as Record<string, CfnResourceWithTags>;
    const expectedTags = [
      { Key: "Owner", Value: "platform" },
      { Key: "Environment", Value: "prod" },
    ];
    expect(tagsOnResource(Object.values(buckets)[0])).toEqual(expect.arrayContaining(expectedTags));
    expect(tagsOnResource(Object.values(topics)[0])).toEqual(expect.arrayContaining(expectedTags));
  });

  it("applies `byComponent` tags only to that component's scope", () => {
    const stackA = new Stack(new App(), "StackA");
    const parent = stackA.node.scope;
    if (!parent) throw new Error("stackA has no scope");
    const stackB = new Stack(parent, "StackB");

    compose(
      { primary: bucketComponent(), notifier: topicComponent() },
      { primary: [], notifier: [] },
    )
      .withStacks({ primary: stackA, notifier: stackB })
      .afterBuild(
        tags({
          byComponent: {
            primary: { Tier: "data" },
            notifier: { Tier: "messaging" },
          },
        }),
      )
      .build(stackA, "MySystem");

    const tA = Template.fromStack(stackA);
    const tB = Template.fromStack(stackB);
    const bucketTags = tagsOnResource(
      Object.values(tA.findResources("AWS::S3::Bucket") as Record<string, CfnResourceWithTags>)[0],
    );
    const topicTags = tagsOnResource(
      Object.values(tB.findResources("AWS::SNS::Topic") as Record<string, CfnResourceWithTags>)[0],
    );

    expect(bucketTags).toEqual(expect.arrayContaining([{ Key: "Tier", Value: "data" }]));
    expect(bucketTags).not.toEqual(expect.arrayContaining([{ Key: "Tier", Value: "messaging" }]));
    expect(topicTags).toEqual(expect.arrayContaining([{ Key: "Tier", Value: "messaging" }]));
    expect(topicTags).not.toEqual(expect.arrayContaining([{ Key: "Tier", Value: "data" }]));
  });

  it("validates tag keys at configuration time", () => {
    expect(() => tags({ system: { "aws:reserved": "x" } })).toThrow(/aws:/);
    expect(() => tags({ system: { "": "x" } })).toThrow(/non-empty/);
    expect(() => tags({ byComponent: { foo: { "bad!key": "x" } } })).toThrow(/character set/);
  });

  it("throws when `byComponent` references an unknown component", () => {
    const stack = new Stack(new App(), "TestStack");

    expect(() => {
      compose({ primary: bucketComponent() }, { primary: [] })
        .afterBuild(
          tags({
            byComponent: {
              // Force an unknown key past the type system to test runtime guard.
              missing: { Owner: "x" },
            } as unknown as { primary?: Record<string, string> },
          }),
        )
        .build(stack, "MySystem");
    }).toThrow(/not a known component/);
  });

  it("composes with builder-level tags so closer scope wins on key collision", () => {
    const stack = new Stack(new App(), "TestStack");

    // A builder-level tag takes precedence over a system-level tag with the
    // same key because Tags.of() applies at a deeper scope. Simulate the
    // wrapper applying a builder-level Owner tag directly — the wrapper
    // itself calls Tags.of(bucket).add(...) for each accumulated tag.
    const taggedBucketComponent: Lifecycle<{ bucket: Bucket }> = {
      build: (scope: IConstruct, id: string) => {
        const bucket = new Bucket(scope, id);
        Tags.of(bucket).add("Owner", "builder");
        return { bucket };
      },
    };

    compose({ primary: taggedBucketComponent }, { primary: [] })
      .afterBuild(tags({ system: { Owner: "system" } }))
      .build(stack, "MySystem");

    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket") as Record<
      string,
      CfnResourceWithTags
    >;
    const ownerTags = tagsOnResource(Object.values(buckets)[0]).filter((t) => t.Key === "Owner");
    expect(ownerTags).toEqual([{ Key: "Owner", Value: "builder" }]);
  });
});
