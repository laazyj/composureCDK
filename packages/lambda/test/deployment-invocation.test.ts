import { describe, it, expect } from "vitest";
import {
  Annotations as CdkAnnotations,
  App,
  CfnParameter,
  type CfnResource,
  Duration,
  Stack,
} from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import type { IConstruct } from "constructs";
import { compose, ref } from "@composurecdk/core";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import { createFunctionBuilder } from "../src/function-builder.js";
import { DEPLOY_INVOKE_TIMEOUT_WARNING_ID } from "../src/deployment-invocation.js";

const TRIGGER = "Custom::Trigger";

/** A minimal, deployable function builder — every test starts from this. */
function handlerBuilder(): ReturnType<typeof createFunctionBuilder> {
  return createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

function synthStack(
  configureFn: (builder: ReturnType<typeof createFunctionBuilder>) => void,
): Stack {
  const stack = new Stack(new App(), "TestStack");
  const builder = handlerBuilder();
  configureFn(builder);
  builder.build(stack, "TestFunction");
  return stack;
}

const synthTemplate = (
  configureFn: (builder: ReturnType<typeof createFunctionBuilder>) => void,
): Template => Template.fromStack(synthStack(configureFn));

/** A stack whose function timeout is an unresolved token. */
function tokenTimeoutStack(
  invoke: (builder: ReturnType<typeof createFunctionBuilder>) => void,
): Stack {
  const stack = new Stack(new App(), "TestStack");
  const seconds = new CfnParameter(stack, "TimeoutParam", { type: "Number" });
  const builder = handlerBuilder().timeout(Duration.seconds(seconds.valueAsNumber));
  invoke(builder);
  builder.build(stack, "TestFunction");
  return stack;
}

interface TriggerResource {
  readonly Properties: { readonly Timeout: string };
  readonly DependsOn?: string[];
}

function triggerResource(template: Template): TriggerResource {
  const [trigger] = Object.values(template.findResources(TRIGGER));
  return trigger as TriggerResource;
}

/** The `Timeout` property is milliseconds, rendered as a string. */
const triggerTimeout = (template: Template): string => triggerResource(template).Properties.Timeout;

const dependsOn = (template: Template): string[] => triggerResource(template).DependsOn ?? [];

/** The logical id a construct's L1 resource lands on, for exact DependsOn assertions. */
const logicalId = (stack: Stack, construct: IConstruct): string =>
  stack.getLogicalId(construct.node.defaultChild as CfnResource);

const findTimeoutWarnings = (stack: Stack): unknown[] =>
  Annotations.fromStack(stack).findWarning(
    "*",
    Match.stringLikeRegexp(DEPLOY_INVOKE_TIMEOUT_WARNING_ID),
  );

describe("invokeOnDeploy", () => {
  describe("build", () => {
    it("creates no deploy-time invocation unless asked for", () => {
      const stack = new Stack(new App(), "TestStack");
      const result = handlerBuilder().build(stack, "TestFunction");

      expect(result.deploymentTrigger).toBeUndefined();
      Template.fromStack(stack).resourceCountIs(TRIGGER, 0);
    });

    it("exposes the custom resource on the build result", () => {
      const stack = new Stack(new App(), "TestStack");
      const result = handlerBuilder().invokeOnDeploy().build(stack, "TestFunction");

      expect(result.deploymentTrigger).toBeDefined();
      Template.fromStack(stack).resourceCountIs(TRIGGER, 1);
    });

    it("replaces the options when called twice", () => {
      const template = synthTemplate((b) => {
        b.timeout(Duration.seconds(30))
          .invokeOnDeploy({ timeout: Duration.minutes(9) })
          .invokeOnDeploy({ timeout: Duration.minutes(4) });
      });

      template.resourceCountIs(TRIGGER, 1);
      expect(triggerTimeout(template)).toBe("240000");
    });
  });

  describe("failure propagation", () => {
    it("invokes synchronously so a failing handler fails the deployment", () => {
      const template = synthTemplate((b) => b.invokeOnDeploy());

      template.hasResourceProperties(TRIGGER, { InvocationType: "RequestResponse" });
    });

    it("re-invokes on handler change by default", () => {
      const template = synthTemplate((b) => b.invokeOnDeploy());

      template.hasResourceProperties(TRIGGER, { ExecuteOnHandlerChange: true });
    });

    it("invokes only on first deployment when executeOnHandlerChange is false", () => {
      const template = synthTemplate((b) => b.invokeOnDeploy({ executeOnHandlerChange: false }));

      template.hasResourceProperties(TRIGGER, { ExecuteOnHandlerChange: false });
    });
  });

  describe("how long the deployment waits", () => {
    it("derives the wait from the function timeout plus the margin", () => {
      const template = synthTemplate((b) => b.timeout(Duration.seconds(30)).invokeOnDeploy());

      expect(triggerTimeout(template)).toBe("60000");
    });

    it("falls back to two minutes when the function has no timeout", () => {
      const template = synthTemplate((b) => b.invokeOnDeploy());

      expect(triggerTimeout(template)).toBe("120000");
    });

    it("falls back when the function timeout is a token", () => {
      const stack = tokenTimeoutStack((b) => b.invokeOnDeploy());

      expect(triggerTimeout(Template.fromStack(stack))).toBe("120000");
    });

    it("caps the derived wait at the trigger provider's own timeout", () => {
      const template = synthTemplate((b) => b.timeout(Duration.minutes(15)).invokeOnDeploy());

      expect(triggerTimeout(template)).toBe("900000");
    });

    it("honours an explicit wait", () => {
      const template = synthTemplate((b) =>
        b.timeout(Duration.seconds(30)).invokeOnDeploy({ timeout: Duration.minutes(5) }),
      );

      expect(triggerTimeout(template)).toBe("300000");
    });
  });

  describe("timeout guard", () => {
    it("warns when the wait is shorter than the function's own timeout", () => {
      const stack = synthStack((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(1) }),
      );

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("warns when the wait exactly equals the function's own timeout", () => {
      const stack = synthStack((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(5) }),
      );

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("warns on the derived wait too, when the cap leaves no margin", () => {
      const stack = synthStack((b) => b.timeout(Duration.minutes(15)).invokeOnDeploy());

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("stays quiet when the explicit wait is longer", () => {
      const stack = synthStack((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(6) }),
      );

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet on the derived wait, which carries the margin", () => {
      const stack = synthStack((b) => b.timeout(Duration.minutes(5)).invokeOnDeploy());

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet when the function timeout is a token, with nothing to compare", () => {
      const stack = tokenTimeoutStack((b) => b.invokeOnDeploy({ timeout: Duration.seconds(1) }));

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet when the wait itself is a token", () => {
      const stack = new Stack(new App(), "TestStack");
      const millis = new CfnParameter(stack, "WaitParam", { type: "Number" });

      handlerBuilder()
        .timeout(Duration.minutes(5))
        // `Duration.millis` is the only unit CDK can render from a token here.
        .invokeOnDeploy({ timeout: Duration.millis(millis.valueAsNumber) })
        .build(stack, "TestFunction");

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("is suppressed by acknowledging the warning id", () => {
      const stack = new Stack(new App(), "TestStack");
      CdkAnnotations.of(stack).acknowledgeWarning(DEPLOY_INVOKE_TIMEOUT_WARNING_ID);

      handlerBuilder()
        .timeout(Duration.minutes(5))
        .invokeOnDeploy({ timeout: Duration.minutes(1) })
        .build(stack, "TestFunction");

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("waits for the execution role, so grants are in place before the call", () => {
      const template = synthTemplate((b) => b.invokeOnDeploy());

      expect(dependsOn(template)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TestFunctionExecutionRole"),
          expect.stringContaining("TestFunctionExecutionRoleDefaultPolicy"),
        ]),
      );
    });

    it("waits for the CDK auto-role when that escape hatch is used", () => {
      const template = synthTemplate((b) => b.useCdkAutoRole().invokeOnDeploy());

      expect(dependsOn(template)).toEqual(
        expect.arrayContaining([expect.stringContaining("ServiceRole")]),
      );
    });

    it("waits for a concrete construct passed to after", () => {
      const stack = new Stack(new App(), "TestStack");
      const queue = new Queue(stack, "SeedQueue");

      handlerBuilder()
        .invokeOnDeploy({ after: [queue] })
        .build(stack, "TestFunction");

      expect(dependsOn(Template.fromStack(stack))).toContain(logicalId(stack, queue));
    });

    it("resolves a ref passed to after against the compose context", () => {
      const stack = new Stack(new App(), "TestStack");

      const results = compose(
        {
          queue: {
            build: (scope: Stack, id: string) => ({ queue: new Queue(scope, id) }),
          },
          handler: handlerBuilder().invokeOnDeploy({
            after: [ref("queue", (r: { queue: Queue }) => r.queue)],
          }),
        },
        { queue: [], handler: ["queue"] },
      ).build(stack, "System");

      expect(dependsOn(Template.fromStack(stack))).toContain(logicalId(stack, results.queue.queue));
    });
  });

  describe("[COPY_STATE]", () => {
    it("preserves #invokeOnDeploy across .copy()", () => {
      assertCopyPreservesState({
        factory: () => handlerBuilder(),
        configure: (b) => {
          b.invokeOnDeploy({ timeout: Duration.minutes(4) });
        },
        mutate: (b) => {
          b.invokeOnDeploy({ timeout: Duration.minutes(9) });
        },
        build: (b) => b.build(new Stack(new App(), "S"), "Function"),
        inspect: (r) => triggerTimeout(Template.fromStack(Stack.of(r.function))),
      });
    });
  });
});
