import { App, Stack } from "aws-cdk-lib";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { createStatementBuilder } from "@composurecdk/iam";
import { createFunctionBuilder } from "@composurecdk/lambda";
import { createBucketBuilder } from "@composurecdk/s3";

/**
 * Lambda function with an explicit, scoped execution role.
 *
 * `createFunctionBuilder` defaults to building an explicit IAM role with an
 * inline `LogsWriter` policy scoped to the function's auto-created log group
 * — no `AWSLambdaBasicExecutionRole`, no wildcard logs surface.
 *
 * `.configureRole(...)` extends the default role builder with additional
 * least-privilege statements; here, granting the function read access to a
 * sibling S3 bucket.
 */
export function createExplicitRoleApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-ExplicitRoleStack");

  const { bucket } = createBucketBuilder().build(stack, "Uploads");

  createFunctionBuilder()
    .runtime(Runtime.NODEJS_22_X)
    .handler("index.handler")
    .code(
      Code.fromInline(
        "exports.handler = async (event) => ({ statusCode: 200, body: JSON.stringify(event) })",
      ),
    )
    .description("Upload processor — reads objects from the uploads bucket")
    .configureRole((role) =>
      role.addInlinePolicyStatements("UploadsRead", [
        createStatementBuilder()
          .allow()
          .actions(["s3:GetObject", "s3:ListBucket"])
          .resources([bucket.bucketArn, `${bucket.bucketArn}/*`]),
      ]),
    )
    .build(stack, "UploadProcessor");

  return { stack };
}
