import { App, Duration } from "aws-cdk-lib";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref, groupedStacks } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";

/**
 * A REST API and its backing Lambda, split across stacks using a
 * {@link StackStrategy} that groups components by a classifier function.
 *
 * The classifier assigns "api" components to a "gateway" group and everything
 * else to a "service" group. Each group gets its own Stack, created via the
 * factory function passed to {@link groupedStacks}.
 *
 * Demonstrates:
 * - Strategy-based stack assignment via `.withStackStrategy()`
 * - Custom scope factory for Stack creation
 * - Automatic grouping — no per-component stack mapping required
 */
export function createStrategyStackApp(app = new App()) {
  const strategy = groupedStacks(
    (key) => (key === "api" ? "gateway" : "service"),
    createStackBuilder().toScopeFactory(),
  );

  compose(
    {
      handler: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "Hello" })'))
        .timeout(Duration.seconds(30))
        .description("Request handler"),

      api: createRestApiBuilder()
        .restApiName("StrategyApi")
        .description("API routed by stack strategy")
        .addMethod(
          "GET",
          ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
        ),
    },
    { handler: [], api: ["handler"] },
  )
    .withStackStrategy(strategy)
    .build(app, "StrategyStackApp");

  return { app };
}
