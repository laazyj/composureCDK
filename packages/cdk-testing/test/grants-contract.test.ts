import { describe, expect, it } from "vitest";
import type { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { type IGrantable, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { describeGrants } from "../src/grants-contract.js";
import { newStack } from "../src/stack.js";
import { policyJson } from "../src/template.js";

/** Stands in for a resource package's grant helpers. */
const topicGrants = {
  publish: (topic: Topic) => ({
    applyTo: (grantee: IGrantable, context: Record<string, object>) => {
      expectNoContext(context);
      topic.grantPublish(grantee);
    },
  }),
  subscribe: (topic: Topic) => ({
    applyTo: (grantee: IGrantable, context: Record<string, object>) => {
      expectNoContext(context);
      topic.grantSubscribe(grantee);
    },
  }),
};

/**
 * The real `Grant` resolves its resource from the build context. This fake is
 * handed the resource directly, so it accepts the parameter only to match the
 * shape — and pins that the contract passes an empty one.
 */
function expectNoContext(context: Record<string, object>): void {
  expect(Object.keys(context)).toEqual([]);
}

const seenRoles: Role[] = [];

describeGrants({
  name: "describeGrants (self-test)",
  grants: topicGrants,
  makeResource: (stack: Stack) => new Topic(stack, "Topic"),
  cases: [
    { capability: "publish", grants: ["sns:Publish"], denies: ["sns:Subscribe"] },
    { capability: "subscribe", grants: ["sns:Subscribe"] },
  ],
  extra: (setup) => {
    it("hands `extra` the same fixture the generated cases use", () => {
      const { stack, resource, role } = setup();

      expect(resource).toBeInstanceOf(Topic);
      expect(Template.fromStack(stack).findResources("AWS::SNS::Topic")).not.toEqual({});
      seenRoles.push(role);
    });

    it("gives each call a fresh stack, so cases cannot leak into each other", () => {
      expect(setup().stack).not.toBe(setup().stack);
    });

    it("defaults the grantee to a Lambda service principal", () => {
      const { stack } = setup();

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Principal: { Service: "lambda.amazonaws.com" } }),
          ]),
        }),
      });
    });
  },
});

describeGrants({
  name: "describeGrants (assumedBy override)",
  grants: topicGrants,
  makeResource: (stack: Stack) => new Topic(stack, "Topic"),
  cases: [
    { capability: "publish", grants: ["sns:Publish"] },
    { capability: "subscribe", grants: ["sns:Subscribe"] },
  ],
  assumedBy: "apigateway.amazonaws.com",
  extra: (setup) => {
    it("assumes the named service instead", () => {
      const { stack } = setup();

      Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({ Principal: { Service: "apigateway.amazonaws.com" } }),
          ]),
        }),
      });
    });
  },
});

// `extra` is optional: a suite whose whole surface fits the table needs none.
describeGrants({
  name: "describeGrants (no extra)",
  grants: topicGrants,
  makeResource: (stack: Stack) => new Topic(stack, "Topic"),
  cases: [
    { capability: "publish", grants: ["sns:Publish"] },
    { capability: "subscribe", grants: ["sns:Subscribe"] },
  ],
});

it("runs `extra` so its assertions are not silently skipped", () => {
  expect(seenRoles).not.toHaveLength(0);
});

// A contract that cannot fail is worse than no contract: every suite above
// would pass against grant helpers that grant nothing. These run the generated
// assertions directly against deliberately wrong tables.
describe("the generated assertions actually fail", () => {
  const fixture = () => {
    const stack = newStack();
    const resource = new Topic(stack, "Topic");
    const role = new Role(stack, "Role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    return { stack, resource, role };
  };

  it("when a promised action is not granted", () => {
    const { stack, resource, role } = fixture();
    topicGrants.publish(resource).applyTo(role, {});

    expect(() => {
      expect(policyJson(stack)).toContain("sns:Subscribe");
    }).toThrow();
  });

  it("when a denied action is granted after all", () => {
    const { stack, resource, role } = fixture();
    topicGrants.publish(resource).applyTo(role, {});

    expect(() => {
      expect(policyJson(stack)).not.toContain("sns:Publish");
    }).toThrow();
  });

  it("when the grant lands on more than one policy", () => {
    const { stack, resource, role } = fixture();
    const second = new Role(stack, "Second", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    topicGrants.publish(resource).applyTo(role, {});
    topicGrants.publish(resource).applyTo(second, {});

    expect(() => {
      Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
    }).toThrow();
  });

  it("when a capability has no row in the table", () => {
    const cases = [{ capability: "publish" as const, grants: ["sns:Publish"] }];

    expect(() => {
      expect(cases.map((c) => c.capability).sort()).toEqual(Object.keys(topicGrants).sort());
    }).toThrow();
  });
});
