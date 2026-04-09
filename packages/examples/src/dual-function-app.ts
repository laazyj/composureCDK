import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { Topic } from "aws-cdk-lib/aws-sns";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";

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
 * - Applying alarm actions via afterBuild hook
 */
export function createDualFunctionApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-DualFunctionStack");

  const alertTopic = new Topic(stack, "AlertTopic");

  compose(
    {
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
    { api: [], worker: [] },
  )
    .afterBuild((_scope, _id, results) => {
      // Apply SNS actions to all alarms across all components
      const allAlarms = [results.api.alarms, results.worker.alarms].flatMap((alarms) =>
        Object.values(alarms),
      );
      for (const alarm of allAlarms) {
        alarm.addAlarmAction(new SnsAction(alertTopic));
      }
    })
    .build(stack, "DualFunctionApp");

  return { stack };
}
