import { App, Duration, Stack } from "aws-cdk-lib";
import { Code, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";

/**
 * Two Lambda functions — an API handler and an async worker — composed
 * into a single stack.
 *
 * Demonstrates:
 * - Configuring multiple functions with different settings
 * - Composing independent components into a system
 */
export function createDualFunctionApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-DualFunctionStack");

  compose(
    {
      api: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async (event) => ({ statusCode: 200 })"))
        .memorySize(256)
        .timeout(Duration.seconds(30))
        .tracing(Tracing.ACTIVE)
        .description("API handler — receives and validates incoming requests"),

      worker: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline("exports.handler = async (event) => { /* process */ }"))
        .memorySize(512)
        .timeout(Duration.minutes(5))
        .tracing(Tracing.ACTIVE)
        .description("Worker — processes requests asynchronously"),
    },
    { api: [], worker: [] },
  ).build(stack, "DualFunctionApp");

  return { stack };
}
