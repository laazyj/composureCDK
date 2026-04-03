import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { compose, Ref, type Lifecycle } from "@composurecdk/core";
import { outputs } from "../src/outputs.js";

function createStack(): Stack {
  return new Stack(new App(), "TestStack");
}

function stubComponent<T extends object>(result: T): Lifecycle<T> {
  return { build: () => result };
}

describe("outputs", () => {
  it("creates CfnOutput constructs for each output definition", () => {
    const stack = createStack();

    compose({ site: stubComponent({ url: "https://example.com" }) }, { site: [] })
      .afterBuild(
        outputs({
          SiteUrl: {
            value: Ref.to<{ url: string }>("site").get("url"),
            description: "The site URL",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    expect(Object.keys(found).length).toBe(1);
  });

  it("resolves Ref values against the build results", () => {
    const stack = createStack();

    compose(
      {
        site: stubComponent({ name: "my-bucket" }),
        cdn: stubComponent({ url: "https://d123.cloudfront.net" }),
      },
      { site: [], cdn: [] },
    )
      .afterBuild(
        outputs({
          BucketName: {
            value: Ref.to<{ name: string }>("site").get("name"),
            description: "Bucket name",
          },
          CdnUrl: {
            value: Ref.to<{ url: string }>("cdn").get("url"),
            description: "CDN URL",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    expect(Object.keys(found).length).toBe(2);

    const bucketOutput = Object.values(found).find(
      (o) => (o as { Description: string }).Description === "Bucket name",
    ) as { Value: string };
    expect(bucketOutput.Value).toBe("my-bucket");

    const cdnOutput = Object.values(found).find(
      (o) => (o as { Description: string }).Description === "CDN URL",
    ) as { Value: string };
    expect(cdnOutput.Value).toBe("https://d123.cloudfront.net");
  });

  it("supports concrete string values (not Refs)", () => {
    const stack = createStack();

    compose({ x: stubComponent({}) }, { x: [] })
      .afterBuild(
        outputs({
          StaticValue: {
            value: "hello-world",
            description: "A static output",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    const output = Object.values(found)[0] as { Value: string };
    expect(output.Value).toBe("hello-world");
  });

  it("includes description when provided", () => {
    const stack = createStack();

    compose({ x: stubComponent({}) }, { x: [] })
      .afterBuild(
        outputs({
          MyOutput: {
            value: "value",
            description: "My description",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    const output = Object.values(found)[0] as { Description: string };
    expect(output.Description).toBe("My description");
  });

  it("omits description when not provided", () => {
    const stack = createStack();

    compose({ x: stubComponent({}) }, { x: [] })
      .afterBuild(
        outputs({
          MyOutput: { value: "value" },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    const output = Object.values(found)[0] as Record<string, unknown>;
    expect(output.Description).toBeUndefined();
  });

  it("includes exportName when provided", () => {
    const stack = createStack();

    compose({ x: stubComponent({}) }, { x: [] })
      .afterBuild(
        outputs({
          MyOutput: {
            value: "value",
            exportName: "MyExport",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    const output = Object.values(found)[0] as { Export: { Name: string } };
    expect(output.Export.Name).toBe("MyExport");
  });

  it("works with Ref.map for transformed values", () => {
    const stack = createStack();

    compose({ cdn: stubComponent({ domain: "d123.cloudfront.net" }) }, { cdn: [] })
      .afterBuild(
        outputs({
          Url: {
            value: Ref.to<{ domain: string }>("cdn").map((r) => `https://${r.domain}`),
            description: "Full URL",
          },
        }),
      )
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    const output = Object.values(found)[0] as { Value: string };
    expect(output.Value).toBe("https://d123.cloudfront.net");
  });

  it("creates no outputs when the definitions record is empty", () => {
    const stack = createStack();

    compose({ x: stubComponent({}) }, { x: [] })
      .afterBuild(outputs({}))
      .build(stack, "System");

    const template = Template.fromStack(stack);
    const found = template.findOutputs("*");
    expect(Object.keys(found).length).toBe(0);
  });
});
