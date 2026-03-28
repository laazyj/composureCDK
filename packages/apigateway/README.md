# @composurecdk/apigateway

API Gateway builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for API Gateway REST APIs with secure, AWS-recommended defaults. It wraps the CDK [RestApi](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.RestApi.html) construct — refer to the CDK documentation for the full set of configurable properties.

## REST API Builder

```ts
import { createRestApiBuilder } from "@composurecdk/apigateway";

const api = createRestApiBuilder()
  .restApiName("My Service")
  .description("Public API")
  .addResource("users", (users) =>
    users
      .addMethod("GET", listUsersIntegration)
      .addResource("{id}", (user) => user.addMethod("GET", getUserIntegration)),
  )
  .build(stack, "MyApi");
```

Every [RestApiProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.RestApiProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createRestApiBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property           | Default | Rationale                                                                           |
| ------------------ | ------- | ----------------------------------------------------------------------------------- |
| `accessLogging`    | `true`  | Auto-creates a CloudWatch log group for access logging with structured JSON output. |
| `tracingEnabled`   | `true`  | Enables X-Ray distributed tracing on the stage.                                     |
| `loggingLevel`     | `INFO`  | Enables CloudWatch execution logging for all methods.                               |
| `dataTraceEnabled` | `false` | Prevents sensitive request/response bodies from appearing in logs.                  |

These defaults are guided by the [AWS Well-Architected Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html).

The defaults are exported as `REST_API_DEFAULTS` for visibility and testing:

```ts
import { REST_API_DEFAULTS } from "@composurecdk/apigateway";
```

### Overriding defaults

```ts
import { MethodLoggingLevel } from "aws-cdk-lib/aws-apigateway";

const api = createRestApiBuilder()
  .restApiName("My Service")
  .accessLogging(false)
  .deployOptions({ tracingEnabled: false, loggingLevel: MethodLoggingLevel.ERROR })
  .build(stack, "MyApi");
```

### Access logging

By default, the builder creates a CloudWatch log group (using `@composurecdk/logs` with its secure defaults) and configures it as the stage's access log destination. The created log group is returned in the build result:

```ts
const result = createRestApiBuilder()
  .restApiName("My Service")
  .addMethod("GET", integration, methodResponse)
  .build(stack, "MyApi");

result.api; // RestApi
result.accessLogGroup; // LogGroup | undefined
```

To provide your own destination instead, set `deployOptions.accessLogDestination` — the auto-created log group is skipped. To disable access logging entirely, set `.accessLogging(false)`.

## Examples

- [LambdaApiStack](../examples/src/lambda-api-app.ts) — REST API backed by a Lambda function, wired with `ref`
- [MockApiStack](../examples/src/mock-api-app.ts) — CRUD REST API with mock integrations
- [MultiStackApp](../examples/src/multi-stack-app.ts) — REST API split across stacks via `.withStacks()`
- [StrategyStackApp](../examples/src/strategy-stack-app.ts) — REST API split across stacks via `.withStackStrategy()`
