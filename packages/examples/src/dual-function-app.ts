import { Duration } from "aws-cdk-lib";
import { Code, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";

/**
 * A simple application with two Lambda functions: an API handler that
 * receives requests, and a worker that processes them asynchronously.
 *
 * Demonstrates:
 * - Configuring multiple functions with different settings
 * - Composing independent components into a system
 * - Using the builder's fluent API
 */
export function createDualFunctionApp() {
  const api = createFunctionBuilder()
    .runtime(Runtime.NODEJS_20_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async (event) => ({ statusCode: 200 })"))
    .memorySize(256)
    .timeout(Duration.seconds(30))
    .tracing(Tracing.ACTIVE)
    .description("API handler — receives and validates incoming requests");

  const worker = createFunctionBuilder()
    .runtime(Runtime.NODEJS_20_X)
    .handler("index.handler")
    .code(Code.fromInline("exports.handler = async (event) => { /* process */ }"))
    .memorySize(512)
    .timeout(Duration.minutes(5))
    .tracing(Tracing.ACTIVE)
    .description("Worker — processes requests asynchronously");

  return compose({ api, worker }, { api: [], worker: [] });
}
