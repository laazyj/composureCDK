import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { compose } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createFunctionBuilder } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";
import { createQueueBuilder } from "@composurecdk/sqs";

/**
 * A primary SQS work queue feeding a Lambda consumer, paired with an SNS
 * alert topic. The queue gets ComposureCDK's recommended SQS alarms by
 * default (oldest-message age, in-flight near-quota); the processor gets
 * the recommended Lambda alarms (errors, throttles — the duration alarm
 * is timeout-relative and the processor leaves timeout at the CDK
 * default, so it is not emitted); a custom alarm watches empty-receive
 * rate as a low-traffic signal. `alarmActionsPolicy` wires every alarm in
 * the stack to publish to the alert topic, so adding more alarms later is
 * automatic.
 *
 * Demonstrates:
 * - `createQueueBuilder` with secure defaults (enforceSSL, SSE-SQS, long polling)
 * - Custom retention via `.retentionPeriod`
 * - Tuning a recommended alarm threshold via `recommendedAlarms`
 * - Adding a workload-specific alarm via `addAlarm`
 * - Wiring the queue to a `createFunctionBuilder` consumer as an SQS event
 *   source (see the wiring note below)
 * - Composing the queue alongside `createTopicBuilder` and routing all
 *   alarm actions through `alarmActionsPolicy`
 */
export function createOrderProcessorApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-OrderProcessorStack");

  const { alerts, orders, processor } = compose(
    {
      alerts: createTopicBuilder().displayName("Order Processor Alerts"),

      orders: createQueueBuilder()
        .queueName("orders")
        // Visibility timeout > expected processing time. Workload-specific —
        // not defaulted by the builder.
        .visibilityTimeout(Duration.minutes(2))
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
                `Consumers are polling but the queue is mostly empty — consider tuning concurrency or pausing pollers. ` +
                `Threshold: > ${String(def.threshold)} empty receives per 5 minutes.`,
            ),
        ),

      processor: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        // Logs each order so the post-deploy smoke test can prove the
        // consumer is wired and the execution role can read the queue.
        .code(
          Code.fromInline(
            "exports.handler = async (event) => { for (const r of event.Records) console.log('processed order', r.body); };",
          ),
        )
        .memorySize(256)
        .description("Order processor — consumes and processes order messages"),
    },
    { alerts: [], orders: [], processor: [] },
  ).build(stack, "OrderProcessor");

  // SQS-to-Lambda wiring. ComposureCDK has no event-source helper yet
  // (see https://github.com/laazyj/composureCDK/issues/118), so the event
  // source is attached directly to the built function. `SqsEventSource`
  // also grants the execution role permission to consume the queue.
  processor.function.addEventSource(new SqsEventSource(orders.queue));

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
