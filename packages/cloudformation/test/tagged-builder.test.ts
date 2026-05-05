import { describe, it, expect, vi, afterEach } from "vitest";
import { App, Stack, Tags } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { type IConstruct } from "constructs";
import { type Lifecycle } from "@composurecdk/core";
import { taggedBuilder, getBuilderTags } from "../src/tagged-builder.js";

interface SyntheticProps {
  enabled?: boolean;
  count?: number;
}

interface SyntheticResult {
  primary: Bucket;
  secondary: Topic;
  alarms: Record<string, Topic>;
  notes: string;
  document: { kind: "policy"; statements: number };
}

class SyntheticBuilder implements Lifecycle<SyntheticResult> {
  props: Partial<SyntheticProps> = {};

  build(scope: IConstruct, id: string): SyntheticResult {
    const stack = scope as Stack;
    return {
      primary: new Bucket(stack, `${id}Primary`),
      secondary: new Topic(stack, `${id}Secondary`),
      alarms: {
        first: new Topic(stack, `${id}AlarmOne`),
        second: new Topic(stack, `${id}AlarmTwo`),
      },
      notes: "not a construct",
      document: { kind: "policy", statements: 3 },
    };
  }
}

interface CfnTagEntry {
  Key: string;
  Value: string;
}

interface CfnResourceWithTags {
  Properties?: { Tags?: CfnTagEntry[] };
}

function tagsOnResource(resource: CfnResourceWithTags): CfnTagEntry[] {
  return resource.Properties?.Tags ?? [];
}

function freshStack(): Stack {
  return new Stack(new App(), "TestStack");
}

describe("taggedBuilder", () => {
  describe("type augmentation", () => {
    it("returns an object with .tag() and .tags() methods that chain", () => {
      const builder = taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder);
      const tagged = builder.tag("Owner", "platform");
      expect(tagged).toBe(builder);
      const both = builder.tags({ Environment: "prod", Project: "rig" });
      expect(both).toBe(builder);
    });

    it("preserves the inner Builder's prop setters and chainability", () => {
      const builder = taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder);
      const chained = builder.enabled(true).count(3).tag("k", "v");
      expect(chained).toBe(builder);
      expect(builder.enabled()).toBe(true);
      expect(builder.count()).toBe(3);
    });
  });

  describe("applies tags to result constructs", () => {
    it("tags the primary construct and all sibling constructs", () => {
      const stack = freshStack();
      const result = taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder)
        .tag("Project", "claude-rig")
        .tag("Owner", "platform")
        .build(stack, "Synth");

      const template = Template.fromStack(stack);
      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        CfnResourceWithTags
      >;
      for (const resource of Object.values(buckets)) {
        expect(tagsOnResource(resource)).toEqual(
          expect.arrayContaining([
            { Key: "Project", Value: "claude-rig" },
            { Key: "Owner", Value: "platform" },
          ]),
        );
      }
      const topics = template.findResources("AWS::SNS::Topic") as Record<
        string,
        CfnResourceWithTags
      >;
      // primary bucket + secondary topic + 2 alarm topics → 3 topics tagged.
      expect(Object.keys(topics)).toHaveLength(3);
      for (const resource of Object.values(topics)) {
        expect(tagsOnResource(resource)).toEqual(
          expect.arrayContaining([
            { Key: "Project", Value: "claude-rig" },
            { Key: "Owner", Value: "platform" },
          ]),
        );
      }
      expect(result.notes).toBe("not a construct");
    });

    it("tags entries inside Record<string, IConstruct> result fields", () => {
      const stack = freshStack();
      taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder)
        .tag("CostCenter", "1234")
        .build(stack, "Synth");

      const template = Template.fromStack(stack);
      const topics = template.findResources("AWS::SNS::Topic") as Record<
        string,
        CfnResourceWithTags
      >;
      // Both alarm topics receive the tag in addition to the secondary topic.
      const taggedTopics = Object.values(topics).filter((r) =>
        tagsOnResource(r).some((t) => t.Key === "CostCenter" && t.Value === "1234"),
      );
      expect(taggedTopics).toHaveLength(3);
    });

    it("does nothing when no tags are accumulated", () => {
      const stack = freshStack();
      taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder).build(stack, "Synth");

      const template = Template.fromStack(stack);
      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        CfnResourceWithTags
      >;
      for (const resource of Object.values(buckets)) {
        // CDK omits Properties.Tags entirely when no tags are configured —
        // Properties may itself be absent for an unconfigured bucket.
        expect(resource.Properties?.Tags).toBeUndefined();
      }
    });

    it("applies all tags supplied via .tags({...})", () => {
      const stack = freshStack();
      taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder)
        .tags({ Owner: "platform", Environment: "prod" })
        .build(stack, "Synth");

      const template = Template.fromStack(stack);
      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        CfnResourceWithTags
      >;
      for (const resource of Object.values(buckets)) {
        expect(tagsOnResource(resource)).toEqual(
          expect.arrayContaining([
            { Key: "Owner", Value: "platform" },
            { Key: "Environment", Value: "prod" },
          ]),
        );
      }
    });
  });

  describe("validation", () => {
    it("throws synchronously at the call site for invalid keys", () => {
      const builder = taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder);
      expect(() => builder.tag("aws:foo", "value")).toThrow(/aws:/);
      expect(() => builder.tag("", "value")).toThrow(/non-empty/);
    });

    it("validates each entry in .tags() independently", () => {
      const builder = taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder);
      expect(() => builder.tags({ Owner: "platform", "bad!key": "value" })).toThrow(
        /character set/,
      );
    });
  });

  describe("duplicate keys", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("last-write wins and emits a process warning", () => {
      const warnings: string[] = [];
      vi.spyOn(process, "emitWarning").mockImplementation((warning: string | Error) => {
        warnings.push(typeof warning === "string" ? warning : warning.message);
      });

      const stack = freshStack();
      taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder)
        .tag("Owner", "first")
        .tag("Owner", "second")
        .build(stack, "Synth");

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/already set to "first"/);
      expect(warnings[0]).toMatch(/overwritten with "second"/);

      const template = Template.fromStack(stack);
      const buckets = template.findResources("AWS::S3::Bucket") as Record<
        string,
        CfnResourceWithTags
      >;
      const allTags = Object.values(buckets).flatMap(tagsOnResource);
      expect(allTags).toEqual(expect.arrayContaining([{ Key: "Owner", Value: "second" }]));
      expect(allTags.find((t) => t.Key === "Owner")?.Value).toBe("second");
    });
  });

  describe("getBuilderTags", () => {
    it("returns an empty map when used on an instance not constructed via taggedBuilder", () => {
      const instance = new SyntheticBuilder();
      expect(getBuilderTags(instance).size).toBe(0);
    });

    it("returns the accumulated tags in insertion order after .tag() calls", () => {
      let captured: CaptureBuilder | undefined;
      class CaptureBuilder extends SyntheticBuilder {
        build(scope: IConstruct, id: string): SyntheticResult {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          captured = this;
          return super.build(scope, id);
        }
      }
      const stack = freshStack();
      taggedBuilder<SyntheticProps, CaptureBuilder>(CaptureBuilder)
        .tag("Owner", "platform")
        .tag("Project", "rig")
        .build(stack, "Synth");

      expect(captured).toBeDefined();
      if (!captured) return;
      const tags = getBuilderTags(captured);
      expect(Array.from(tags.entries())).toEqual([
        ["Owner", "platform"],
        ["Project", "rig"],
      ]);
    });
  });

  describe("Tags.of equivalence", () => {
    it("matches the behaviour of calling Tags.of(...).add(...) on each construct", () => {
      const stackA = freshStack();
      taggedBuilder<SyntheticProps, SyntheticBuilder>(SyntheticBuilder)
        .tag("Owner", "platform")
        .build(stackA, "Synth");

      const stackB = freshStack();
      const direct = new SyntheticBuilder().build(stackB, "Synth");
      Tags.of(direct.primary).add("Owner", "platform");
      Tags.of(direct.secondary).add("Owner", "platform");
      Tags.of(direct.alarms.first).add("Owner", "platform");
      Tags.of(direct.alarms.second).add("Owner", "platform");

      const aTemplate = JSON.stringify(Template.fromStack(stackA).toJSON());
      const bTemplate = JSON.stringify(Template.fromStack(stackB).toJSON());
      expect(aTemplate).toBe(bTemplate);
    });
  });
});
