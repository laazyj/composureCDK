import { describe, it, expect } from "vitest";
import { App, Stack, type CfnResource } from "aws-cdk-lib";
import { Topic } from "aws-cdk-lib/aws-sns";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Template } from "aws-cdk-lib/assertions";
import { type IConstruct } from "constructs";
import { ref } from "@composurecdk/core";
import { addDependenciesFromRefs, collectConstructs } from "../src/dependencies.js";

function collect(value: unknown): IConstruct[] {
  const out = new Set<IConstruct>();
  collectConstructs(value, out, new WeakSet());
  return [...out];
}

describe("collectConstructs", () => {
  it("ignores primitives and null", () => {
    expect(collect(42)).toEqual([]);
    expect(collect("s")).toEqual([]);
    expect(collect(null)).toEqual([]);
    expect(collect(undefined)).toEqual([]);
  });

  it("finds a top-level construct and does not descend into its node tree", () => {
    const topic = new Topic(new Stack(new App(), "S"), "T");
    expect(collect({ topic })).toEqual([topic]);
  });

  it("descends into nested construct maps and arrays", () => {
    const stack = new Stack(new App(), "S");
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");
    expect(collect({ alarms: { a }, list: [b] }).sort()).toEqual([a, b].sort());
  });

  it("ignores plain objects with no constructs", () => {
    expect(collect({ name: "x", nested: { count: 1 } })).toEqual([]);
  });

  it("guards against cycles in plain-object graphs", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(collect(cyclic)).toEqual([]);
  });
});

describe("addDependenciesFromRefs", () => {
  it("adds a DependsOn to every construct reachable through the named refs", () => {
    const stack = new Stack(new App(), "S");
    const a = new Topic(stack, "A");
    const b = new Topic(stack, "B");
    const cr = new AwsCustomResource(stack, "CR", {
      onCreate: {
        service: "SNS",
        action: "publish",
        parameters: { TopicArn: "arn", Message: "hi" },
        physicalResourceId: PhysicalResourceId.of("x"),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false,
    });

    addDependenciesFromRefs(cr, [ref<{ topic: Topic }>("a"), ref<{ topic: Topic }>("b")], {
      a: { topic: a },
      b: { topic: b },
    });

    const dependsOn = Object.values(Template.fromStack(stack).findResources("Custom::AWS"))[0]
      .DependsOn as string[];
    expect(dependsOn).toContain(stack.getLogicalId(a.node.defaultChild as CfnResource));
    expect(dependsOn).toContain(stack.getLogicalId(b.node.defaultChild as CfnResource));
  });
});
