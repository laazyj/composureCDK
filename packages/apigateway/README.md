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

## Recommended Alarms

Both builders create [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#ApiGateway) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm         | Metric                    | Default threshold | Created when |
| ------------- | ------------------------- | ----------------- | ------------ |
| `clientError` | 4XXError (Average, 1 min) | > 0.05 (5%)       | Always       |
| `serverError` | 5XXError (Average, 1 min) | > 0.05 (5%)       | Always       |
| `latency`     | Latency (p90, 1 min)      | >= 2500ms         | Always       |

Alarm metrics include both `ApiName` and `Stage` dimensions, targeting the deployment stage created by the builder.

The defaults are exported as `REST_API_ALARM_DEFAULTS` for visibility and testing:

```ts
import { REST_API_ALARM_DEFAULTS } from "@composurecdk/apigateway";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const api = createRestApiBuilder()
  .restApiName("My Service")
  .addMethod("GET", integration, methodResponse)
  .recommendedAlarms({
    serverError: { threshold: 0.1 }, // 10% error rate
    latency: { threshold: 1000 }, // 1 second p90
    clientError: { evaluationPeriods: 3 }, // fewer evaluation periods
  });
```

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable individual alarms:

```ts
builder.recommendedAlarms({ clientError: false, latency: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `RestApiBase`, so the metric factory has access to the API's properties.

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

const api = createRestApiBuilder()
  .restApiName("My Service")
  .addMethod("GET", integration, methodResponse)
  .addAlarm("integrationLatency", (alarm) =>
    alarm
      .metric(
        (api) =>
          new Metric({
            namespace: "AWS/ApiGateway",
            metricName: "IntegrationLatency",
            dimensionsMap: {
              ApiName: api.restApiName,
              Stage: api.deploymentStage.stageName,
            },
            statistic: "p90",
            period: Duration.minutes(1),
          }),
      )
      .threshold(2000)
      .greaterThanOrEqual()
      .description("Integration latency is elevated"),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = api.build(stack, "MyApi");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## Examples

- [MockApiStack](../examples/src/mock-api-app.ts) — CRUD REST API with mock integrations and recommended alarms with custom thresholds
- [MultiStackApp](../examples/src/multi-stack-app.ts) — REST API + Lambda split across stacks via `.withStacks()`, wired with `ref`
