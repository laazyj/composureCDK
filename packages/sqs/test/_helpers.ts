import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import type { IQueue } from "aws-cdk-lib/aws-sqs";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import { assertCopyPreservesState } from "@composurecdk/core/testing";
import type { QueueBuilderResult } from "../src/build-queue.js";

interface BuildableQueue {
  build(scope: Stack, id: string): QueueBuilderResult;
}

/** Builds a queue builder into a fresh stack and returns the synth artefacts. */
export function buildQueueStack<B extends BuildableQueue>(
  factory: () => B,
  id: string,
  configureFn?: (builder: B) => void,
): { stack: Stack; result: QueueBuilderResult; template: Template } {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const builder = factory();
  configureFn?.(builder);
  const result = builder.build(stack, id);
  return { stack, result, template: Template.fromStack(stack) };
}

/**
 * Asserts the secure defaults shared by every queue builder in this
 * package: SSE-SQS encryption, long polling, and the enforceSSL
 * deny-insecure-transport queue policy.
 */
export function expectSharedSecureDefaults(template: Template): void {
  template.hasResourceProperties("AWS::SQS::Queue", {
    SqsManagedSseEnabled: true,
    ReceiveMessageWaitTimeSeconds: 20,
  });
  template.hasResourceProperties("AWS::SQS::QueuePolicy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: "Deny",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        }),
      ]),
    }),
  });
}

interface CopyableQueueBuilder extends BuildableQueue {
  copy(): CopyableQueueBuilder;
  addAlarm(
    key: string,
    configure: (alarm: AlarmDefinitionBuilder<IQueue>) => AlarmDefinitionBuilder<IQueue>,
  ): unknown;
}

/**
 * Asserts that custom alarms added via `addAlarm` survive `.copy()` —
 * the shared `[COPY_STATE]` contract every queue builder implements.
 */
export function expectCopyPreservesCustomAlarms(factory: () => CopyableQueueBuilder): void {
  assertCopyPreservesState({
    factory,
    configure: (b) => {
      b.addAlarm("firstCustom", (a) =>
        a
          .metric((queue) => queue.metricNumberOfEmptyReceives())
          .threshold(1)
          .greaterThan(),
      );
    },
    mutate: (b) => {
      b.addAlarm("secondCustom", (a) =>
        a
          .metric((queue) => queue.metricNumberOfEmptyReceives())
          .threshold(5)
          .greaterThan(),
      );
    },
    build: (b) => b.build(new Stack(new App(), "S"), "Queue"),
    inspect: (r) => Object.keys(r.alarms).sort(),
  });
}
