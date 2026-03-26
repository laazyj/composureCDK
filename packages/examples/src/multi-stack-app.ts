import { App, Duration } from "aws-cdk-lib";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";

/**
 * A REST API and its backing Lambda, split across two stacks using the
 * compose-level stack map.
 *
 * Demonstrates:
 * - Routing components to different stacks via {@link ComposedSystem.withStacks}
 * - Cross-stack references resolved automatically by CDK
 * - Components without a stack mapping fall back to the default scope
 */
export function createMultiStackApp(app = new App()) {
  const { stack: serviceStack } = createStackBuilder()
    .description("Service resources for multi-stack example")
    .build(app, "MultiStackServiceStack");
  const { stack: apiStack } = createStackBuilder()
    .description("API resources for multi-stack example")
    .build(app, "MultiStackApiStack");

  compose(
    {
      handler: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "Hello" })'))
        .timeout(Duration.seconds(30))
        .description("Request handler"),

      api: createRestApiBuilder()
        .restApiName("MultiStackApi")
        .description("API in a separate stack from its handler")
        .addMethod(
          "GET",
          ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
        ),
    },
    { handler: [], api: ["handler"] },
  )
    .withStacks({
      handler: serviceStack,
      api: apiStack,
    })
    .build(app, "MultiStackApp");

  return { serviceStack, apiStack };
}
