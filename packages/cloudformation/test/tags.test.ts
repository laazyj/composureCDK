import { describe, it, expect } from "vitest";
import { App, Stack, Tags } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";
import { compose, groupedStacks, singleStack, type Lifecycle } from "@composurecdk/core";
import { tagsPerResource } from "@composurecdk/cdk-testing";
import { createStackBuilder } from "../src/stack-builder.js";
import { tags } from "../src/tags.js";

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

/** A bucket component whose own builder-level `.tag()` sets `Tier=builder`. */
function builderTaggedBucketComponent(): Lifecycle<{ bucket: Bucket }> {
  return {
    build: (scope: IConstruct, id: string) => {
      const bucket = new Bucket(scope, id);
      Tags.of(bucket).add("Tier", "builder");
      return { bucket };
    },
  };
}

/** A bucket component that also creates a topic it does not return. */
function bucketWithHiddenTopicComponent(): Lifecycle<{ bucket: Bucket }> {
  return {
    build: (scope: IConstruct, id: string) => {
      new Topic(scope, `${id}Hidden`);
      return { bucket: new Bucket(scope, id) };
    },
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
    const expectedTags = [
      { Key: "Owner", Value: "platform" },
      { Key: "Environment", Value: "prod" },
    ];
    expect(tagsPerResource(template, "AWS::S3::Bucket")[0]).toEqual(
      expect.arrayContaining(expectedTags),
    );
    expect(tagsPerResource(template, "AWS::SNS::Topic")[0]).toEqual(
      expect.arrayContaining(expectedTags),
    );
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
    const bucketTags = tagsPerResource(tA, "AWS::S3::Bucket")[0];
    const topicTags = tagsPerResource(tB, "AWS::SNS::Topic")[0];

    expect(bucketTags).toEqual(expect.arrayContaining([{ Key: "Tier", Value: "data" }]));
    expect(bucketTags).not.toEqual(expect.arrayContaining([{ Key: "Tier", Value: "messaging" }]));
    expect(topicTags).toEqual(expect.arrayContaining([{ Key: "Tier", Value: "messaging" }]));
    expect(topicTags).not.toEqual(expect.arrayContaining([{ Key: "Tier", Value: "data" }]));
  });

  it("keeps `byComponent` tags off siblings that share the component's scope", () => {
    const stack = new Stack(new App(), "TestStack");

    compose(
      { primary: bucketComponent(), notifier: topicComponent() },
      { primary: [], notifier: [] },
    )
      .afterBuild(tags({ byComponent: { primary: { Tier: "data" } } }))
      .build(stack, "MySystem");

    const template = Template.fromStack(stack);
    expect(tagsPerResource(template, "AWS::S3::Bucket")[0]).toEqual([
      { Key: "Tier", Value: "data" },
    ]);
    expect(tagsPerResource(template, "AWS::SNS::Topic")[0]).toEqual([]);
  });

  it("treats a stack shared by two components as shared, and tags a stack of one whole", () => {
    const app = new App({ context: { "@aws-cdk/core:explicitStackTags": true } });

    compose(
      {
        primary: bucketComponent(),
        notifier: topicComponent(),
        archive: bucketWithHiddenTopicComponent(),
      },
      { primary: [], notifier: [], archive: [] },
    )
      .withStackStrategy(
        groupedStacks(
          { service: createStackBuilder(), archive: createStackBuilder() },
          { primary: "service", notifier: "service", archive: "archive" },
        ),
      )
      .afterBuild(
        tags({ byComponent: { primary: { Tier: "data" }, archive: { Tier: "archive" } } }),
      )
      .build(app, "MySystem");

    const assembly = app.synth();
    const service = assembly.getStackByName("MySystem-service");
    const archive = assembly.getStackByName("MySystem-archive");

    const serviceTemplate = Template.fromJSON(service.template as Record<string, unknown>);
    expect(tagsPerResource(serviceTemplate, "AWS::S3::Bucket")[0]).toEqual([
      { Key: "Tier", Value: "data" },
    ]);
    expect(tagsPerResource(serviceTemplate, "AWS::SNS::Topic")[0]).toEqual([]);
    expect(service.tags).toEqual({});

    // A component with a stack of its own: the Stack and the topic it did not return are tagged.
    const archiveTemplate = Template.fromJSON(archive.template as Record<string, unknown>);
    expect(tagsPerResource(archiveTemplate, "AWS::SNS::Topic")[0]).toEqual([
      { Key: "Tier", Value: "archive" },
    ]);
    expect(archive.tags).toEqual({ Tier: "archive" });
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

  it("composes with builder-level tags so the builder's tag wins on key collision", () => {
    const stack = new Stack(new App(), "TestStack");

    compose({ primary: builderTaggedBucketComponent() }, { primary: [] })
      .afterBuild(tags({ system: { Tier: "system" } }))
      .build(stack, "MySystem");

    const tierTags = tagsPerResource(Template.fromStack(stack), "AWS::S3::Bucket")[0].filter(
      (t) => t.Key === "Tier",
    );
    expect(tierTags).toEqual([{ Key: "Tier", Value: "builder" }]);
  });

  it.each([
    ["a shared scope", false],
    ["a stack of its own", true],
  ])("keeps builder over `byComponent` over `system` in %s", (_, ownStack) => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const system = compose(
      { tagged: builderTaggedBucketComponent(), plain: bucketComponent() },
      { tagged: [], plain: [] },
    );
    const composed = ownStack
      ? system.withStacks({ tagged: stack, plain: new Stack(app, "Other") })
      : system;
    const root = ownStack ? app : stack;
    composed
      .afterBuild(
        tags({
          system: { Tier: "system", Owner: "system" },
          byComponent: { tagged: { Tier: "component", Owner: "component" } },
        }),
      )
      .build(root, "MySystem");

    const bucketTags = tagsPerResource(Template.fromStack(stack), "AWS::S3::Bucket")[0];
    expect(bucketTags).toEqual(
      expect.arrayContaining([
        { Key: "Tier", Value: "builder" },
        { Key: "Owner", Value: "component" },
      ]),
    );
  });

  // `tags()` receives the scope `build()` was called with, which under a stack
  // strategy is the App — not a Stack. `@aws-cdk/core:explicitStackTags` makes
  // `Tags.of().add()` skip `aws:cdk:stack` anywhere in that subtree, so the
  // stacks the strategy created would carry no stack-level tag at all. That is
  // the tag cost allocation keys on, and `system` is documented as the place to
  // put it.
  it("applies system tags to a strategy's stacks under explicitStackTags", () => {
    const app = new App({ context: { "@aws-cdk/core:explicitStackTags": true } });

    compose({ primary: bucketComponent() }, { primary: [] })
      .withStackStrategy(singleStack(createStackBuilder()))
      .afterBuild(tags({ system: { Owner: "platform" } }))
      .build(app, "MySystem");

    expect(app.synth().getStackByName("MySystem").tags).toEqual({ Owner: "platform" });
  });
});
