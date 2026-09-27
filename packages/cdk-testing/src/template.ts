import type { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

/**
 * Synthesises `stack` and returns its whole template as a JSON string.
 *
 * The intended use is a substring assertion over IAM policy documents, where
 * naming the exact statement would mean reproducing CDK's `Fn::Join` /
 * `Fn::GetAtt` structure around the one action under test:
 *
 * ```ts
 * expect(policyJson(stack)).toContain("kms:Decrypt");
 * ```
 *
 * That is deliberately a coarse check — it proves the action reached *a*
 * policy in the stack, not which principal holds it. Prefer
 * `Template.fromStack(stack).hasResourceProperties(...)` where the assertion
 * is about a specific policy's shape.
 */
export function policyJson(stack: Stack): string {
  return JSON.stringify(Template.fromStack(stack).toJSON());
}

/** A CloudFormation tag as it appears in a synthesised template. */
export interface CfnTagEntry {
  Key: string;
  Value: string;
}

/** A synthesised resource, as `Template.findResources` returns it. */
interface TaggableResource {
  Properties?: { Tags?: CfnTagEntry[] };
}

/**
 * The tags on each resource of `type`, one entry per matching resource, in the
 * order `Template.findResources` returns them.
 *
 * ```ts
 * expect(tagsPerResource(template, "AWS::S3::Bucket")).toEqual([
 *   [{ Key: "Owner", Value: "platform" }],
 * ]);
 * ```
 *
 * `findResources` is typed as `Record<string, any>`, so every suite asserting
 * over tags otherwise repeats the same cast to reach `Properties.Tags`. This
 * owns that cast once.
 *
 * Reach for it where a matcher cannot express the assertion — a tag's
 * *absence*, the arity of tag entries, or a branch on what the installed
 * aws-cdk-lib renders. Where the assertion is "a resource of this type has
 * these tags", `hasResourceProperties(type, { Tags: Match.arrayWith(...) })`
 * says so directly and reads better.
 *
 * A resource with no `Tags` property normalises to an empty array, which is
 * what a tag assertion wants — but it means the result cannot tell an absent
 * `Tags` from an empty one. Where that difference is the point, assert
 * `{ Tags: Match.absent() }` through `allResourcesProperties` instead.
 */
export function tagsPerResource(template: Template, type: string): CfnTagEntry[][] {
  const resources = template.findResources(type) as Record<string, TaggableResource>;
  return Object.values(resources).map((resource) => resource.Properties?.Tags ?? []);
}
