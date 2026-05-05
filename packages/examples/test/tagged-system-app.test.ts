import { describe, it, expect } from "vitest";
import { Template } from "aws-cdk-lib/assertions";
import { createTaggedSystemApp } from "../src/tagged-system-app.js";

interface CfnTagEntry {
  Key: string;
  Value: string;
}
interface CfnResourceWithTags {
  Properties?: { Tags?: CfnTagEntry[] };
}

function tagsOnAll(template: Template, type: string): CfnTagEntry[][] {
  const resources = template.findResources(type) as Record<string, CfnResourceWithTags>;
  return Object.values(resources).map((r) => r.Properties?.Tags ?? []);
}

describe("tagged-system-app", () => {
  const { stack } = createTaggedSystemApp();
  const template = Template.fromStack(stack);

  it("applies the selector tag only to the EC2 instance via .tag()", () => {
    const instanceTags = tagsOnAll(template, "AWS::EC2::Instance");
    expect(instanceTags).toHaveLength(1);
    expect(instanceTags[0]).toEqual(
      expect.arrayContaining([{ Key: "Project", Value: "claude-rig" }]),
    );
  });

  it("does not apply the selector tag to siblings (bucket, VPC)", () => {
    const bucketTags = tagsOnAll(template, "AWS::S3::Bucket").flat();
    const vpcTags = tagsOnAll(template, "AWS::EC2::VPC").flat();
    expect(bucketTags.find((t) => t.Key === "Project")).toBeUndefined();
    expect(vpcTags.find((t) => t.Key === "Project")).toBeUndefined();
  });

  it("applies system-wide tags to every taggable construct", () => {
    const expected = [
      { Key: "Owner", Value: "platform" },
      { Key: "Environment", Value: "prod" },
      { Key: "CostCenter", Value: "1234" },
    ];
    const types = ["AWS::EC2::Instance", "AWS::S3::Bucket", "AWS::EC2::VPC", "AWS::Logs::LogGroup"];
    for (const type of types) {
      const allTags = tagsOnAll(template, type);
      expect(allTags.length).toBeGreaterThan(0);
      for (const tags of allTags) {
        expect(tags).toEqual(expect.arrayContaining(expected));
      }
    }
  });
});
