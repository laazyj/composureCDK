import { Duration, Stack } from "aws-cdk-lib";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import {
  createGuardrailBuilder,
  type ApplicationInferenceProfileBuilderResult,
  createApplicationInferenceProfileBuilder,
  createModelAlarmBuilder,
  createModelInvocationLoggingBuilder,
  type GuardrailBuilderResult,
  inferenceProfile,
  modelGrants,
} from "@composurecdk/bedrock";
import { combine, compose, ref } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createFunctionBuilder, sqsEventSource } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";
import { createQueueBuilder, type QueueBuilderResult } from "@composurecdk/sqs";
import { exampleApp } from "./app-context.js";

/**
 * A global profile, so the stack deploys in any commercial Region whether or
 * not the model has an in-Region or geographic profile there.
 */
const TRIAGE_MODEL = inferenceProfile.global(
  new FoundationModelIdentifier("amazon.nova-2-lite-v1:0"),
);

/**
 * Classifies each order note through the guardrail and logs the result, or
 * that the guardrail blocked it, for the smoke test. Failed records are
 * reported individually so a retry re-sends only those.
 */
const PROCESSOR_CODE = `
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const client = new BedrockRuntimeClient({});
const PROMPT = "Classify this order note as exactly one word: gift, complaint, delivery or other. Note: ";
exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const r of event.Records) {
    try {
      const res = await client.send(new ConverseCommand({
        modelId: process.env.MODEL_ID,
        messages: [{ role: "user", content: [{ text: PROMPT + r.body }] }],
        inferenceConfig: { maxTokens: 10, temperature: 0 },
        guardrailConfig: {
          guardrailIdentifier: process.env.GUARDRAIL_ARN,
          guardrailVersion: process.env.GUARDRAIL_VERSION,
        },
      }));
      const outcome = res.stopReason === "guardrail_intervened"
        ? "blocked=guardrail"
        : "category=" + res.output.message.content[0].text.trim().toLowerCase();
      console.log("processed order", r.body, outcome);
    } catch (err) {
      console.error("failed to classify order", r.messageId, err);
      batchItemFailures.push({ itemIdentifier: r.messageId });
    }
  }
  return { batchItemFailures };
};
`;

/**
 * Order intake fanned out through SNS to an SQS work queue, which feeds a
 * Lambda consumer that triages each order's note with an Amazon Bedrock
 * model — paired with a separate SNS alert topic for alarms.
 * Publishers write one event to the `orderEvents` topic; SNS delivers it
 * to the `orders` queue (raw, by subscription default) and the consumer
 * drains it. New subscribers (an audit log, a fraud check) attach to the
 * topic without touching the publisher.
 *
 * The queue gets ComposureCDK's recommended SQS alarms by default
 * (oldest-message age, in-flight near-quota); the processor gets the
 * recommended Lambda alarms (errors, throttles, duration against its
 * 30-second timeout) plus the event-source contextual alarms
 * (failed-invocation, dropped-event) once the queue is wired in; a custom
 * alarm watches empty-receive rate as a low-traffic signal.
 * `alarmActionsPolicy` wires every alarm in the stack to publish to the
 * alert topic, so adding more alarms later is automatic.
 *
 * Demonstrates:
 * - `createQueueBuilder` with secure defaults (enforceSSL, SSE-SQS, long polling)
 * - Custom retention via `.retentionPeriod`
 * - Tuning a recommended alarm threshold via `recommendedAlarms`
 * - Adding a workload-specific alarm via `addAlarm`
 * - Wiring the queue to a `createFunctionBuilder` consumer via
 *   `sqsEventSource` and a `ref` to the sibling queue
 * - SNS → SQS fan-out via `TopicBuilder.addSubscription`, with a
 *   **caller-owned dead-letter queue** on the subscription (see
 *   "Subscription reliability" in the SNS README): the DLQ is an explicit
 *   `createQueueBuilder("dlq")` sibling, and `combine` assembles the
 *   subscription from both queues
 * - Composing the queues alongside `createTopicBuilder` and routing all
 *   alarm actions through `alarmActionsPolicy`
 * - Invoking a model through an application inference profile over a global
 *   cross-Region profile, tagged so the order processor's model usage shows in
 *   cost allocation, with `modelGrants.invoke` on the consumer and
 *   `createModelAlarmBuilder` for the model's alarms
 * - Model invocation logging via `createModelInvocationLoggingBuilder`,
 *   with its delivery-failure alarm
 * - A guardrail from `createGuardrailBuilder`, which the consumer must apply:
 *   `modelGrants.invoke(…, { requireGuardrail })` denies any call without it
 */
export function createOrderProcessorApp(app = exampleApp()) {
  const stack = new Stack(app, "ComposureCDK-OrderProcessorStack");
  const guardrail = ref<GuardrailBuilderResult>("safety").get("reference");
  const triageProfile =
    ref<ApplicationInferenceProfileBuilderResult>("triageProfile").get("profile");

  const { alerts } = compose(
    {
      alerts: createTopicBuilder().displayName("Order Processor Alerts"),

      // Intake topic. Its recommended alarms include the two redrive
      // metrics (NumberOfNotificationsRedrivenToDlq, ...FailedToRedrive),
      // which only report data once a subscription has a DLQ attached —
      // as the orders subscription below does.
      orderEvents: createTopicBuilder()
        .displayName("Order Events")
        // Fan-out to the work queue. `SqsSubscription` carries the
        // subscription's dead-letter queue: SNS parks a notification there
        // when delivery to the queue keeps failing (throttling, a queue
        // policy change), so an intake event is never silently lost. The
        // DLQ is declared as a sibling below and referenced here.
        .addSubscription(
          "orders",
          combine(
            {
              orders: ref<QueueBuilderResult>("orders"),
              dlq: ref<QueueBuilderResult>("orderEventsDlq"),
            },
            ({ orders, dlq }) => new SqsSubscription(orders.queue, { deadLetterQueue: dlq.queue }),
          ),
        ),

      // The subscription's DLQ. The "dlq" role defaults retention to the
      // SQS maximum (14 days) and ships the dead-letter depth alarm, which
      // — routed through alarmActionsPolicy below — is what turns an
      // undelivered notification into a page.
      orderEventsDlq: createQueueBuilder("dlq").queueName("order-events-dlq"),

      orders: createQueueBuilder()
        .queueName("orders")
        // At least 6x the processor's timeout, so Lambda can retry a
        // throttled batch. Workload-specific — not defaulted by the builder.
        .visibilityTimeout(Duration.minutes(3))
        // Retain undelivered work for the full SQS maximum so a downstream
        // incident can be replayed.
        .retentionPeriod(Duration.days(14))
        .recommendedAlarms({
          // This queue's SLA is tighter than the 5-minute default. Alert
          // when the oldest message has waited more than 1 minute and the
          // condition holds for two consecutive evaluations.
          approximateAgeOfOldestMessage: {
            threshold: 60,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
          },
        })
        .addAlarm("highEmptyReceiveRate", (alarm) =>
          alarm
            .metric((queue) => queue.metricNumberOfEmptyReceives({ period: Duration.minutes(5) }))
            .threshold(500)
            .greaterThan()
            .description(
              (def) =>
                `Consumers are polling but the queue is mostly empty - consider tuning concurrency or pausing pollers. ` +
                `Threshold: > ${String(def.threshold)} empty receives per 5 minutes.`,
            ),
        ),

      processor: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline(PROCESSOR_CODE))
        .memorySize(256)
        .timeout(Duration.seconds(30))
        .environment({
          MODEL_ID: triageProfile.get("profileArn"),
          GUARDRAIL_ARN: guardrail.get("guardrailArn"),
          GUARDRAIL_VERSION: guardrail.get("version"),
        })
        .grant(modelGrants.invoke(triageProfile, { requireGuardrail: guardrail }))
        .description("Order processor - consumes and processes order messages")
        // The event source is declared as data: `sqsEventSource` resolves
        // the sibling queue `ref` at build time and `addEventSource` grants
        // the consume permission onto the function's least-privilege role.
        .addEventSource(
          "orders",
          sqsEventSource(ref("orders", (r: QueueBuilderResult) => r.queue)),
        ),

      triageProfile: createApplicationInferenceProfileBuilder()
        .inferenceProfileName("order-triage")
        .source(TRIAGE_MODEL)
        .tag("CostCentre", "order-processing"),

      triageModelAlarms: createModelAlarmBuilder().model(triageProfile),

      safety: createGuardrailBuilder().name("order-triage"),

      // Account-wide per Region: deploying this stack turns logging on for the
      // account, replacing any existing configuration, and deleting it turns
      // logging off. A real system would build it once, in a shared stack.
      invocationLogging: createModelInvocationLoggingBuilder(),
    },
    {
      alerts: [],
      orderEventsDlq: [],
      orders: [],
      orderEvents: ["orders", "orderEventsDlq"],
      processor: ["orders", "triageProfile", "safety"],
      triageProfile: [],
      triageModelAlarms: ["triageProfile"],
      safety: [],
      invocationLogging: [],
    },
  ).build(stack, "OrderProcessor");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
