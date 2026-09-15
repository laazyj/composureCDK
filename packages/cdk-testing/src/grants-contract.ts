import { describe, expect, it } from "vitest";
import type { Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { type IGrantable, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { newStack } from "./stack.js";
import { policyJson } from "./template.js";

/**
 * The slice of `@composurecdk/core`'s `Grant` this contract uses.
 *
 * Declared structurally rather than imported: `@composurecdk/cdk-testing` is
 * tagged `scope:tooling`, which `@nx/enforce-module-boundaries` forbids from
 * depending on any workspace library.
 */
interface GrantLike {
  applyTo(grantee: IGrantable, context: Record<string, object>): void;
}

/** One capability of a resource's grant helpers, and what it must grant. */
export interface GrantCase<C extends string> {
  /** The key on the grants object — `"publish"`, `"readWrite"`. */
  readonly capability: C;
  /** Actions the synthesised policy must contain. */
  readonly grants: readonly string[];
  /**
   * Actions that must appear nowhere in the synthesised template, for a
   * capability that deliberately withholds something adjacent — `admin` on a
   * KMS key grants lifecycle operations but no cryptographic use.
   *
   * This checks the whole template rather than just the grantee's policy, so
   * it also catches an action that reaches the grantee by another route.
   */
  readonly denies?: readonly string[];
}

/** The fixture each generated test runs against. */
export interface GrantsFixture<T> {
  readonly stack: Stack;
  readonly resource: T;
  readonly role: Role;
}

/**
 * Asserts the shared contract every resource package's grant helpers hold:
 * each capability puts its actions on the grantee's policy, and puts them on
 * exactly one policy.
 *
 * Eight packages had written this suite by hand. What actually varied between
 * them was the resource under test and the capability/action table — so those
 * are the arguments, and everything else is generated.
 *
 * Tests that are genuinely specific to one resource belong in `extra`, which
 * receives the same fixture factory the generated tests use. That is where a
 * package asserts on grant conditions, ARN narrowing, or its own `ref`
 * generics, rather than bending the table to express them.
 *
 * @example
 * ```ts
 * describeGrants({
 *   name: "topicGrants",
 *   grants: topicGrants,
 *   makeResource: (stack) => new Topic(stack, "Topic"),
 *   cases: [
 *     { capability: "publish", grants: ["sns:Publish"] },
 *     { capability: "subscribe", grants: ["sns:Subscribe"] },
 *   ],
 *   extra: (setup) => {
 *     it("resolves a Resolvable topic from the build context", () => {
 *       const { stack, resource, role } = setup();
 *       // …
 *     });
 *   },
 * });
 * ```
 */
export function describeGrants<T, C extends string>(args: {
  /** Names the `describe` block — the grants export under test. */
  readonly name: string;
  /** The grants object, e.g. `topicGrants`. */
  readonly grants: Readonly<Record<C, (resource: T) => GrantLike>>;
  /** Creates the resource in the fixture's stack. */
  readonly makeResource: (stack: Stack) => T;
  /** One row per capability. */
  readonly cases: readonly GrantCase<C>[];
  /**
   * The service the grantee role assumes. Defaults to Lambda, which is what a
   * grantee is in nearly every suite; the lambda suite overrides it, since the
   * thing invoking a function is typically an API rather than another function.
   */
  readonly assumedBy?: string;
  /** Tests specific to this resource, sharing the generated fixture. */
  readonly extra?: (setup: () => GrantsFixture<T>) => void;
}): void {
  const { name, grants, makeResource, cases, assumedBy = "lambda.amazonaws.com", extra } = args;

  const setup = (): GrantsFixture<T> => {
    const stack = newStack();
    const resource = makeResource(stack);
    const role = new Role(stack, "Role", { assumedBy: new ServicePrincipal(assumedBy) });
    return { stack, resource, role };
  };

  describe(name, () => {
    it("covers every capability the grants object exposes", () => {
      // The table is the suite. A capability added to `grants` without a row
      // here would otherwise go untested silently — which is the failure the
      // hand-written suites were equally open to, and the one a table makes
      // cheap to close.
      expect(cases.map((c) => c.capability).sort()).toEqual(Object.keys(grants).sort());
    });

    it.each(cases)("$capability grants its actions to the grantee", (grantCase) => {
      const { stack, resource, role } = setup();

      grants[grantCase.capability](resource).applyTo(role, {});

      const json = policyJson(stack);
      for (const action of grantCase.grants) {
        expect(json, `${grantCase.capability} must grant ${action}`).toContain(action);
      }
      Template.fromStack(stack).resourceCountIs("AWS::IAM::Policy", 1);
    });

    const withholding = cases.flatMap((c) =>
      c.denies === undefined ? [] : [{ capability: c.capability, denies: c.denies }],
    );
    if (withholding.length > 0) {
      it.each(withholding)("$capability withholds the actions it must not grant", (grantCase) => {
        const { stack, resource, role } = setup();

        grants[grantCase.capability](resource).applyTo(role, {});

        const json = policyJson(stack);
        for (const action of grantCase.denies) {
          expect(json, `${grantCase.capability} must not grant ${action}`).not.toContain(action);
        }
      });
    }

    extra?.(setup);
  });
}
