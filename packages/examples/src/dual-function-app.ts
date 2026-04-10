import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * Two Lambda functions — an API handler and an async worker — composed
 * into a single stack.
 *
 * Demonstrates:
 * - Configuring multiple functions with different settings
 * - Composing independent components into a system
 * - Recommended alarms created by default (errors, throttles, duration)
 * - Customizing alarm thresholds on the worker
 * - Adding a custom alarm via `addAlarm`
 * - Using TopicBuilder for the alert topic with recommended alarms
 * - Applying alarm actions via afterBuild hook
 */
export function createDualFunctionApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-DualFunctionStack");

  compose(
    {
      alerts: createTopicBuilder().displayName("Dual Function Alerts"),

      api: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async (event) => ({ statusCode: 200 })"))
        .memorySize(256)
        .timeout(Duration.seconds(30))
        .tracing(Tracing.ACTIVE)
        .description("API handler — receives and validates incoming requests")
        .addAlarm("highInvocations", (alarm) =>
          alarm
            .metric((fn) => fn.metricInvocations({ period: Duration.minutes(1) }))
            .threshold(1000)
            .greaterThanOrEqual()
            .description(
              (def) =>
                `API receiving unusually high traffic. Threshold: >= ${String(def.threshold)} invocations per minute.`,
            ),
        ),

      worker: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async (event) => { /* process */ }"))
        .memorySize(512)
        .timeout(Duration.minutes(5))
        .reservedConcurrentExecutions(50)
        .tracing(Tracing.ACTIVE)
        .description("Worker — processes requests asynchronously")
        .recommendedAlarms({
          // Worker can tolerate occasional errors — only alarm after 5
          errors: { threshold: 5, evaluationPeriods: 3, datapointsToAlarm: 2 },
        }),
    },
    { alerts: [], api: [], worker: [] },
  )
    .afterBuild((_scope, _id, results) => {
      // Apply SNS actions to all alarms across all components
      const allAlarms = [results.api.alarms, results.worker.alarms].flatMap((alarms) =>
        Object.values(alarms),
      );
      const action = new SnsAction(results.alerts.topic);
      for (const alarm of allAlarms) {
        alarm.addAlarmAction(action);
      }
    })
    .build(stack, "DualFunctionApp");

  return { stack };
}
