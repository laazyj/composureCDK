# @composurecdk/lambda

Lambda builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for AWS Lambda functions with secure, AWS-recommended defaults. It wraps the CDK [Function](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.Function.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Function Builder

```ts
import { createFunctionBuilder } from "@composurecdk/lambda";

const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .build(stack, "MyFunction");
```

Every [FunctionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.FunctionProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createFunctionBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property        | Default  | Rationale                                                                            |
| --------------- | -------- | ------------------------------------------------------------------------------------ |
| `tracing`       | `ACTIVE` | Enables X-Ray distributed tracing for observability.                                 |
| `loggingFormat` | `JSON`   | Structured logs for CloudWatch Logs Insights auto-discovery and consistent querying. |

These defaults are guided by the [AWS Well-Architected Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/opex-distributed-tracing.html).

The defaults are exported as `FUNCTION_DEFAULTS` for visibility and testing:

```ts
import { FUNCTION_DEFAULTS } from "@composurecdk/lambda";
```

### Overriding defaults

```ts
import { LoggingFormat, Tracing } from "aws-cdk-lib/aws-lambda";

const handler = createFunctionBuilder()
  .runtime(Runtime.NODEJS_22_X)
  .handler("index.handler")
  .code(Code.fromAsset("lambda"))
  .tracing(Tracing.PASS_THROUGH)
  .loggingFormat(LoggingFormat.TEXT)
  .build(stack, "MyFunction");
```

## Examples

- [LambdaApiStack](../examples/src/lambda-api-app.ts) — REST API backed by a Lambda function, wired with `ref`
- [DualFunctionStack](../examples/src/dual-function-app.ts) — Two Lambda functions with different configurations
- [MultiStackApp](../examples/src/multi-stack-app.ts) — Lambda split across stacks via `.withStacks()`
- [StrategyStackApp](../examples/src/strategy-stack-app.ts) — Lambda split across stacks via `.withStackStrategy()`
