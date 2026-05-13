import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { compose } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createTopicBuilder } from "@composurecdk/sns";
import { createQueueBuilder } from "@composurecdk/sqs";

/**
 * A primary SQS work queue paired with an SNS alert topic. The queue
 * gets ComposureCDK's recommended SQS alarms by default (oldest-message
 * age, in-flight near-quota); a custom alarm watches empty-receive rate
 * as a low-traffic signal. `alarmActionsPolicy` wires every alarm in the
 * stack to publish to the alert topic, so adding more alarms later
 * (recommended or custom) is automatic.
 *
 * Demonstrates:
 * - `createQueueBuilder` with secure defaults (enforceSSL, SSE-SQS, long polling)
 * - Custom retention via `.retentionPeriod`
 * - Tuning a recommended alarm threshold via `recommendedAlarms`
 * - Adding a workload-specific alarm via `addAlarm`
 * - Composing the queue alongside `createTopicBuilder` and routing all
 *   alarm actions through `alarmActionsPolicy`
 */
export function createOrderProcessorApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-OrderProcessorStack");

  const { alerts } = compose(
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
    },
    { alerts: [], orders: [] },
  ).build(stack, "OrderProcessor");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
