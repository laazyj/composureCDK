import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";

/**
 * A REST API backed by a Lambda function, wired together with {@link compose}.
 *
 * Demonstrates:
 * - Cross-component references using {@link ref}
 * - Lambda proxy integration with API Gateway
 * - Dependency-driven build ordering
 *
 * Resource tree:
 * ```
 * /
 * ├── GET          → handler (Lambda proxy)
 * └── users/
 *     ├── GET      → handler (Lambda proxy)
 *     └── {id}/
 *         └── GET  → handler (Lambda proxy)
 * ```
 */
export function createLambdaApiApp() {
  return compose(
    {
      handler: createFunctionBuilder()
        .runtime(Runtime.NODEJS_20_X)
        .handler("index.handler")
        .code(Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "Hello" })'))
        .description("API request handler"),

      api: createRestApiBuilder()
        .restApiName("LambdaApi")
        .description("REST API backed by Lambda")
        .addMethod(
          "GET",
          ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
        )
        .addResource("users", (users) =>
          users
            .addMethod(
              "GET",
              ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
            )
            .addResource("{id}", (user) =>
              user.addMethod(
                "GET",
                ref("handler", (r: FunctionBuilderResult) => new LambdaIntegration(r.function)),
              ),
            ),
        ),
    },
    { handler: [], api: ["handler"] },
  );
}
