import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { compose, Ref, type Lifecycle } from "@composurecdk/core";
import { outputs } from "../src/outputs.js";
import { groupedStacks } from "../src/strategies.js";

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

  describe("per-output scope", () => {
    it("routes outputs to a directly-supplied Stack via an IConstruct scope", () => {
      const app = new App();
      const hookStack = new Stack(app, "Hook");
      const other = new Stack(app, "Other");

      compose({ x: stubComponent({}) }, { x: [] })
        .afterBuild(
          outputs({
            OnHook: { value: "h" },
            OnOther: { value: "o", scope: other },
          }),
        )
        .build(hookStack, "System");

      expect(Object.keys(Template.fromStack(hookStack).findOutputs("*"))).toEqual(["OnHook"]);
      expect(Object.keys(Template.fromStack(other).findOutputs("*"))).toEqual(["OnOther"]);
    });

    it("routes outputs to a directly-supplied Stack under .withStacks()", () => {
      const app = new App();
      const siteStack = new Stack(app, "Site");
      const dnsStack = new Stack(app, "Dns");

      compose(
        { site: stubComponent({ url: "example.com" }), dns: stubComponent({ zone: "z123" }) },
        { site: [], dns: [] },
      )
        .withStacks({ site: siteStack, dns: dnsStack })
        .afterBuild(
          outputs({
            SiteUrl: { value: "https://example.com", scope: siteStack },
            NameServers: { value: "ns1", scope: dnsStack },
          }),
        )
        .build(app, "System");

      expect(Object.keys(Template.fromStack(siteStack).findOutputs("*"))).toEqual(["SiteUrl"]);
      expect(Object.keys(Template.fromStack(dnsStack).findOutputs("*"))).toEqual(["NameServers"]);
    });

    it("routes outputs via a component key under .withStacks()", () => {
      const app = new App();
      const siteStack = new Stack(app, "Site");
      const dnsStack = new Stack(app, "Dns");

      compose(
        { site: stubComponent({ url: "example.com" }), dns: stubComponent({ zone: "z123" }) },
        { site: [], dns: [] },
      )
        .withStacks({ site: siteStack, dns: dnsStack })
        .afterBuild(
          outputs({
            SiteUrl: { value: "https://example.com", scope: "site" },
            NameServers: { value: "ns1", scope: "dns" },
          }),
        )
        .build(app, "System");

      expect(Object.keys(Template.fromStack(siteStack).findOutputs("*"))).toEqual(["SiteUrl"]);
      expect(Object.keys(Template.fromStack(dnsStack).findOutputs("*"))).toEqual(["NameServers"]);
    });

    it("routes outputs via a component key under .withStackStrategy()", () => {
      const app = new App();
      const classify = (k: string) => (k === "data" ? "data" : "compute");

      compose(
        { data: stubComponent({ name: "t1" }), api: stubComponent({ route: "/" }) },
        { data: [], api: ["data"] },
      )
        .withStackStrategy(groupedStacks(classify, (parent, id) => new Stack(parent as App, id)))
        .afterBuild(
          outputs({
            TableName: { value: "tbl", scope: "data" },
            ApiRoute: { value: "/v1", scope: "api" },
          }),
        )
        .build(app, "System");

      const stacks = app.node.children.filter((c): c is Stack => c instanceof Stack);
      const dataStack = stacks.find((s) => s.node.id === "System-data");
      const computeStack = stacks.find((s) => s.node.id === "System-compute");
      if (dataStack === undefined || computeStack === undefined) {
        throw new Error("strategy did not create expected stacks");
      }

      expect(Object.keys(Template.fromStack(dataStack).findOutputs("*"))).toEqual(["TableName"]);
      expect(Object.keys(Template.fromStack(computeStack).findOutputs("*"))).toEqual(["ApiRoute"]);
    });

    it("resolves a Ref value into the chosen scope's template", () => {
      const app = new App();
      const siteStack = new Stack(app, "Site");
      const dnsStack = new Stack(app, "Dns");

      compose(
        { site: stubComponent({ url: "example.com" }), dns: stubComponent({ zone: "z123" }) },
        { site: [], dns: [] },
      )
        .withStacks({ site: siteStack, dns: dnsStack })
        .afterBuild(
          outputs({
            SiteUrl: {
              value: Ref.to<{ url: string }>("site").map((r) => `https://${r.url}`),
              scope: "site",
            },
          }),
        )
        .build(app, "System");

      const output = Object.values(Template.fromStack(siteStack).findOutputs("*"))[0] as {
        Value: string;
      };
      expect(output.Value).toBe("https://example.com");
    });

    it("creates the CloudFormation Export on the target stack when combined with exportName", () => {
      const app = new App();
      const siteStack = new Stack(app, "Site");
      const dnsStack = new Stack(app, "Dns");

      compose({ site: stubComponent({}), dns: stubComponent({}) }, { site: [], dns: [] })
        .withStacks({ site: siteStack, dns: dnsStack })
        .afterBuild(
          outputs({
            NameServers: { value: "ns1", scope: "dns", exportName: "ZoneServers" },
          }),
        )
        .build(app, "System");

      expect(Object.keys(Template.fromStack(siteStack).findOutputs("*"))).toEqual([]);
      const dnsOutputs = Template.fromStack(dnsStack).findOutputs("*");
      const output = dnsOutputs.NameServers as { Export: { Name: string } };
      expect(output.Export.Name).toBe("ZoneServers");
    });

    it("throws a clear error when scope references an unknown component key", () => {
      const app = new App();
      const siteStack = new Stack(app, "Site");
      const badDefs = {
        Broken: { value: "x", scope: "missing" },
      } as unknown as Parameters<typeof outputs>[0];

      expect(() =>
        compose({ site: stubComponent({}) }, { site: [] })
          .withStacks({ site: siteStack })
          .afterBuild(outputs(badDefs))
          .build(app, "System"),
      ).toThrow(/unknown component "missing"/);
    });
  });
});
