import { App, Duration, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Schedule } from "aws-cdk-lib/aws-events";
import { Code, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createRuleBuilder, lambdaTarget } from "@composurecdk/events";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * Two Lambda functions — an API handler and an async worker — composed
 * into a single stack. The worker also runs on a 15-minute EventBridge
 * schedule wired through `@composurecdk/events`.
 *
 * Demonstrates:
 * - Configuring multiple functions with different settings
 * - Composing independent components into a system
 * - Recommended alarms created by default (errors, throttles, duration)
 * - Customizing alarm thresholds on the worker
 * - Adding a custom alarm via `addAlarm`
 * - Using TopicBuilder for the alert topic with recommended alarms
 * - Using RuleBuilder + lambdaTarget to schedule a sibling Lambda via `ref`
 * - Routing every alarm (function + rule) to the alert topic via
 *   `alarmActionsPolicy`
 */
export function createDualFunctionApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-DualFunctionStack");

  const { alerts } = compose(
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

      workerSchedule: createRuleBuilder()
        .schedule(Schedule.rate(Duration.minutes(15)))
        .description("Tick the worker every 15 minutes")
        .addTarget("worker", lambdaTarget(ref("worker", (r: FunctionBuilderResult) => r.function))),
    },
    { alerts: [], api: [], worker: [], workerSchedule: ["worker"] },
  ).build(stack, "DualFunctionApp");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
