import { describe, it, expect } from "vitest";
import {
  Annotations as CdkAnnotations,
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
import { buildFixture, newStack } from "@composurecdk/cdk-testing";
import { createFunctionBuilder } from "../src/function-builder.js";
import {
  INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID,
  INVOKE_ON_DEPLOY_DEFAULTS,
} from "../src/invoke-on-deploy.js";

const TRIGGER = "Custom::Trigger";
const VERSION = "AWS::Lambda::Version";

/** Logical-id prefix of the provider Lambda CDK creates for `Trigger`. */
const TRIGGER_PROVIDER_PREFIX = "AWSCDKTriggerCustomResourceProvider";

/** A minimal, deployable function builder — every test starts from this. */
function handlerBuilder(): ReturnType<typeof createFunctionBuilder> {
  return createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async () => {}"));
}

const buildAndSynth = buildFixture(handlerBuilder, "TestFunction");

/** Configures a function whose timeout is an unresolved token. */
const withTokenTimeout =
  (invoke: (builder: ReturnType<typeof createFunctionBuilder>) => void) =>
  (builder: ReturnType<typeof createFunctionBuilder>, stack: Stack): void => {
    const seconds = new CfnParameter(stack, "TimeoutParam", { type: "Number" });
    builder.timeout(Duration.seconds(seconds.valueAsNumber));
    invoke(builder);
  };

interface TriggerResource {
  readonly Properties: { readonly Timeout: string; readonly HandlerArn: unknown };
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
    Match.stringLikeRegexp(INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID),
  );

describe("invokeOnDeploy", () => {
  describe("build", () => {
    it("creates no deploy-time invocation unless asked for", () => {
      const { result, template } = buildAndSynth();

      expect(result.deploymentTrigger).toBeUndefined();
      template.resourceCountIs(TRIGGER, 0);
    });

    it("exposes the custom resource on the build result", () => {
      const { result, template } = buildAndSynth((b) => b.invokeOnDeploy());

      expect(result.deploymentTrigger).toBeDefined();
      template.resourceCountIs(TRIGGER, 1);
    });

    it("replaces the options when called twice", () => {
      const { template } = buildAndSynth((b) => {
        b.timeout(Duration.seconds(30))
          .invokeOnDeploy({ timeout: Duration.minutes(9) })
          .invokeOnDeploy({ timeout: Duration.minutes(4) });
      });

      template.resourceCountIs(TRIGGER, 1);
      expect(triggerTimeout(template)).toBe("240000");
    });
  });

  describe("what reaches the template", () => {
    it("publishes a version of the handler, which is what the trigger invokes", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());

      // `Trigger` addresses the handler by `currentVersion`, so the version is
      // the invalidation mechanism: its ARN moves when the function's config
      // does, and that property change is what CloudFormation acts on.
      template.resourceCountIs(VERSION, 1);

      const [versionId] = Object.keys(template.findResources(VERSION));
      expect(JSON.stringify(triggerResource(template).Properties.HandlerArn)).toContain(versionId);
    });

    it("publishes the version even when re-invocation is off", () => {
      const { template } = buildAndSynth((b) =>
        b.invokeOnDeploy({ executeOnHandlerChange: false }),
      );

      template.resourceCountIs(VERSION, 1);
    });

    it("adds no version when the action is not used", () => {
      const { template } = buildAndSynth();

      template.resourceCountIs(VERSION, 0);
    });
  });

  describe("failure propagation", () => {
    it("invokes synchronously so a failing handler fails the deployment", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());

      template.hasResourceProperties(TRIGGER, { InvocationType: "RequestResponse" });
    });

    it("re-invokes on handler change by default", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());

      template.hasResourceProperties(TRIGGER, { ExecuteOnHandlerChange: true });
    });

    it("invokes only on first deployment when executeOnHandlerChange is false", () => {
      const { template } = buildAndSynth((b) =>
        b.invokeOnDeploy({ executeOnHandlerChange: false }),
      );

      template.hasResourceProperties(TRIGGER, { ExecuteOnHandlerChange: false });
    });
  });

  describe("how long the deployment waits", () => {
    it("derives the wait from the function timeout plus the margin", () => {
      const { template } = buildAndSynth((b) => b.timeout(Duration.seconds(30)).invokeOnDeploy());

      expect(triggerTimeout(template)).toBe("60000");
    });

    it("falls back to two minutes when the function has no timeout", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());

      expect(triggerTimeout(template)).toBe("120000");
    });

    it("falls back when the function timeout is a token", () => {
      const { template } = buildAndSynth(withTokenTimeout((b) => b.invokeOnDeploy()));

      expect(triggerTimeout(template)).toBe("120000");
    });

    it("caps the derived wait short of the trigger provider's own timeout", () => {
      const { template } = buildAndSynth((b) => b.timeout(Duration.minutes(15)).invokeOnDeploy());

      // 14m30s, not 15m: the provider needs the remainder to report the result.
      expect(triggerTimeout(template)).toBe("870000");
    });

    it("honours an explicit wait", () => {
      const { template } = buildAndSynth((b) =>
        b.timeout(Duration.seconds(30)).invokeOnDeploy({ timeout: Duration.minutes(5) }),
      );

      expect(triggerTimeout(template)).toBe("300000");
    });

    it("allows an explicit wait at exactly the cap", () => {
      const { template } = buildAndSynth((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.seconds(870) }),
      );

      expect(triggerTimeout(template)).toBe("870000");
    });

    it("throws on an explicit wait above the cap rather than clamping it", () => {
      expect(() =>
        buildAndSynth((b) =>
          b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.seconds(871) }),
        ),
      ).toThrow(/cannot wait longer than 870s[\s\S]*hangs it/);
    });

    it("keeps the cap below the trigger provider's own synthesised timeout", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());
      const [provider] = Object.entries(template.findResources("AWS::Lambda::Function"))
        .filter(([logicalId]) => logicalId.startsWith(TRIGGER_PROVIDER_PREFIX))
        .map(([, resource]) => resource as { Properties: { Timeout: number } });

      // The whole point of the cap is to leave this provider room to report the
      // result. Its 15-minute timeout is CDK's own default, which `Trigger`
      // neither overrides nor exposes — so the assumption is pinned against the
      // real template. A CDK release that lowers it fails here, rather than
      // quietly reopening the hung deployment the cap exists to prevent.
      expect(provider.Properties.Timeout).toBe(900);
      expect(INVOKE_ON_DEPLOY_DEFAULTS.maxTimeout.toSeconds()).toBeLessThan(
        provider.Properties.Timeout,
      );
    });

    it("passes a token wait through, with nothing to compare against the cap", () => {
      expect(() =>
        buildAndSynth((b, stack) => {
          const millis = new CfnParameter(stack, "WaitParam", { type: "Number" });
          b.invokeOnDeploy({ timeout: Duration.millis(millis.valueAsNumber) });
        }),
      ).not.toThrow();
    });
  });

  describe("timeout guard", () => {
    it("warns when the wait is shorter than the function's own timeout", () => {
      const { stack } = buildAndSynth((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(1) }),
      );

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("warns when the wait exactly equals the function's own timeout", () => {
      const { stack } = buildAndSynth((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(5) }),
      );

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("warns on the derived wait too, when the cap leaves no margin", () => {
      const { stack } = buildAndSynth((b) => b.timeout(Duration.minutes(15)).invokeOnDeploy());

      expect(findTimeoutWarnings(stack)).toHaveLength(1);
    });

    it("stays quiet when the explicit wait is longer", () => {
      const { stack } = buildAndSynth((b) =>
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(6) }),
      );

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet on the derived wait, which carries the margin", () => {
      const { stack } = buildAndSynth((b) => b.timeout(Duration.minutes(5)).invokeOnDeploy());

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet when the function timeout is a token, with nothing to compare", () => {
      const { stack } = buildAndSynth(
        withTokenTimeout((b) => b.invokeOnDeploy({ timeout: Duration.seconds(1) })),
      );

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("stays quiet when the wait itself is a token", () => {
      const { stack } = buildAndSynth((b, s) => {
        const millis = new CfnParameter(s, "WaitParam", { type: "Number" });
        b.timeout(Duration.minutes(5))
          // `Duration.millis` is the only unit CDK can render from a token here.
          .invokeOnDeploy({ timeout: Duration.millis(millis.valueAsNumber) });
      });

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });

    it("is suppressed by acknowledging the warning id", () => {
      const { stack } = buildAndSynth((b, s) => {
        CdkAnnotations.of(s).acknowledgeWarning(INVOKE_ON_DEPLOY_TIMEOUT_WARNING_ID);
        b.timeout(Duration.minutes(5)).invokeOnDeploy({ timeout: Duration.minutes(1) });
      });

      expect(findTimeoutWarnings(stack)).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("waits for the execution role, so grants are in place before the call", () => {
      const { template } = buildAndSynth((b) => b.invokeOnDeploy());

      expect(dependsOn(template)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TestFunctionExecutionRole"),
          expect.stringContaining("TestFunctionExecutionRoleDefaultPolicy"),
        ]),
      );
    });

    it("waits for the CDK auto-role when that escape hatch is used", () => {
      const { template } = buildAndSynth((b) => b.useCdkAutoRole().invokeOnDeploy());

      expect(dependsOn(template)).toEqual(
        expect.arrayContaining([expect.stringContaining("ServiceRole")]),
      );
    });

    it("waits for a concrete construct passed to after", () => {
      let queue!: Queue;
      const { template, stack } = buildAndSynth((b, s) => {
        queue = new Queue(s, "SeedQueue");
        b.invokeOnDeploy({ after: [queue] });
      });

      expect(dependsOn(template)).toContain(logicalId(stack, queue));
    });

    it("waits for every construct when after names a whole component", () => {
      const stack = newStack();

      const results = compose(
        {
          seed: {
            build: (scope: Stack, id: string) => ({
              queue: new Queue(scope, `${id}Queue`),
              dlq: new Queue(scope, `${id}Dlq`),
            }),
          },
          handler: handlerBuilder().invokeOnDeploy({
            // The whole component, not one construct out of it: the dead-letter
            // queue is a peer of the queue, so no selector on the queue reaches it.
            after: [ref<{ queue: Queue; dlq: Queue }>("seed")],
          }),
        },
        { seed: [], handler: ["seed"] },
      ).build(stack, "System");

      const deps = dependsOn(Template.fromStack(stack));
      expect(deps).toContain(logicalId(stack, results.seed.queue));
      expect(deps).toContain(logicalId(stack, results.seed.dlq));
    });

    it("resolves a ref passed to after against the compose context", () => {
      const stack = newStack();

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

  describe("deploymentTrigger on the result", () => {
    it("gates a sibling on the call having succeeded via executeBefore", () => {
      // Built by hand rather than through the fixture: `executeBefore` runs
      // against the returned result, and the fixture synthesises eagerly.
      const stack = newStack();
      const downstream = new Queue(stack, "Downstream");
      const result = handlerBuilder().invokeOnDeploy().build(stack, "TestFunction");

      result.deploymentTrigger?.executeBefore(downstream);

      const queue = Template.fromStack(stack).findResources("AWS::SQS::Queue")[
        logicalId(stack, downstream)
      ] as { DependsOn?: string[] };

      expect(queue.DependsOn ?? []).toEqual(
        expect.arrayContaining([expect.stringContaining("DeploymentTrigger")]),
      );
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
        build: (b) => b.build(newStack(), "Function"),
        inspect: (r) => triggerTimeout(Template.fromStack(Stack.of(r.function))),
      });
    });
  });
});
