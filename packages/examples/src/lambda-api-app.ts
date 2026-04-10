import { App } from "aws-cdk-lib";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * A REST API backed by a Lambda function, composed into a single stack.
 *
 * Demonstrates:
 * - Cross-component references using {@link ref}
 * - Lambda proxy integration with API Gateway
 * - Dependency-driven build ordering
 * - Building the composed system into a CDK Stack
 * - Recommended alarms for Lambda, API Gateway, and SNS
 * - Customizing API Gateway alarm thresholds
 * - Using TopicBuilder for the alert topic with recommended alarms
 * - Applying alarm actions via afterBuild hook
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
export function createLambdaApiApp(app = new App()) {
  const { stack } = createStackBuilder()
    .description("REST API backed by a Lambda function")
    .build(app, "ComposureCDK-LambdaApiStack");

  compose(
    {
      alerts: createTopicBuilder().displayName("Lambda API Alerts"),

      handler: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline('exports.handler = async () => ({ statusCode: 200, body: "Hello" })'))
        .description("API request handler"),

      api: createRestApiBuilder()
        .restApiName("LambdaApi")
        .description("REST API backed by Lambda")
        .recommendedAlarms({
          // Tighter server error threshold for a production API
          serverError: { threshold: 0.02 },
        })
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
    { alerts: [], handler: [], api: ["handler"] },
  )
    .afterBuild((_scope, _id, results) => {
      // Apply SNS actions to all alarms across Lambda and API Gateway
      const allAlarms = [results.handler.alarms, results.api.alarms].flatMap((alarms) =>
        Object.values(alarms),
      );
      const action = new SnsAction(results.alerts.topic);
      for (const alarm of allAlarms) {
        alarm.addAlarmAction(action);
      }
    })
    .build(stack, "LambdaApiApp");

  return { stack };
}
