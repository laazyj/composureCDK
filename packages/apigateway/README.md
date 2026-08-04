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

### Integrations

`addMethod` accepts any CDK [Integration](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.Integration.html) — `LambdaIntegration`, `MockIntegration`, `HttpIntegration`, or `AwsIntegration` to call an AWS service directly with no Lambda in the request path. To wire an integration to a sibling builder (e.g. a DynamoDB table's name and an IAM role for API Gateway to assume), assemble it with `ref`/`combine` so the integration resolves once its dependencies are built:

- [**CrudApiStack**](../examples/src/crud-api-app.ts) — a complete CRUD REST API wired straight to DynamoDB via `AwsIntegration` and VTL mapping templates (`Scan`/`PutItem`/`GetItem`/`DeleteItem`), with the credentials role assembled from sibling builders using `combine` and granted via consumer-side `tableGrants`. Start here for the `AwsIntegration` → DynamoDB pattern.

## Spec REST API Builder

`createSpecRestApiBuilder` builds a [SpecRestApi](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.SpecRestApi.html) — a REST API whose resources, methods and integrations come entirely from an OpenAPI specification rather than from `addResource`/`addMethod` calls. Every [SpecRestApiProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway.SpecRestApiProps.html) property is a fluent setter, and the same secure defaults, access logging and recommended alarms apply as for `createRestApiBuilder`.

```ts
import { ApiDefinition } from "aws-cdk-lib/aws-apigateway";
import { createSpecRestApiBuilder } from "@composurecdk/apigateway";

const api = createSpecRestApiBuilder()
  .restApiName("PetStore")
  .apiDefinition(ApiDefinition.fromInline(petstoreSpec))
  .build(stack, "PetStoreApi");
```

### Specs that reference sibling resources

A model-first spec — a Smithy or OpenAPI export, or a hand-written document — usually names the resources its integrations call: the ARN of the Lambda to invoke, the role API Gateway assumes to invoke it. Those values do not exist while the builder is being configured. They exist only once the siblings have been built.

`apiDefinition` therefore accepts a `Resolvable<ApiDefinition>` — a concrete definition, or a `ref`/`combine` that produces one at build time. The specification stays declarative, the substitution stays a plain function you can test on its own, and the whole API stays inside `compose`:

```ts
import { ApiDefinition } from "aws-cdk-lib/aws-apigateway";
import { combine, compose, ref } from "@composurecdk/core";
import { createSpecRestApiBuilder } from "@composurecdk/apigateway";
import {
  createFunctionBuilder,
  functionGrants,
  type FunctionBuilderResult,
} from "@composurecdk/lambda";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";

compose(
  {
    handler: createFunctionBuilder()
      .runtime(Runtime.NODEJS_22_X)
      .handler("index.handler")
      .code(code),

    // The role API Gateway assumes to invoke the handler — an ordinary
    // sibling, wired with a consumer-side grant (ADR-0013).
    gatewayRole: createServiceRoleBuilder("apigateway.amazonaws.com").grant(
      functionGrants.invoke(ref<FunctionBuilderResult>("handler", (r) => r.function)),
    ),

    api: createSpecRestApiBuilder()
      .restApiName("PetStore")
      .apiDefinition(
        combine(
          {
            handler: ref<FunctionBuilderResult>("handler"),
            gatewayRole: ref<RoleBuilderResult>("gatewayRole"),
          },
          ({ handler, gatewayRole }) =>
            ApiDefinition.fromInline(
              withIntegration(petstoreSpec, {
                functionArn: handler.function.functionArn,
                credentialsArn: gatewayRole.role.roleArn,
              }),
            ),
        ),
      ),
  },
  { handler: [], gatewayRole: ["handler"], api: ["handler", "gatewayRole"] },
);
```

A single dependency needs only a `ref`; `combine` is for the case above, where one definition is assembled from two or more siblings ([ADR-0015](../../docs/adr/0015-combine-multi-ref-combinator.md)).

Two things to know when writing the substitution:

- **Reach for the account, region or partition via `Aws.*`.** A transform receives the build context, not a construct scope, so `Stack.of(scope)` is not available to it — see [Resolvable](../../docs/architecture.md#resolvable). `Aws.PARTITION` and `Aws.REGION` need no scope and resolve correctly inside the API body.
- **An inline body is embedded in the CloudFormation template.** A large generated specification counts against the template size limit; load it from S3 with `ApiDefinition.fromBucket` if it grows (at the cost of the in-process substitution shown here).

## Invoke grants

To let a principal call an IAM-authorized API (`authorizationType: AuthorizationType.IAM`), `restApiGrants` provides a consumer-side grant helper — the mirror of DynamoDB's `tableGrants`. Declare it on the **grantee** (the caller), pointing at the API via a `ref`, exactly as you would any other grant ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)):

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createRestApiBuilder,
  restApiGrants,
  type RestApiBuilderResult,
} from "@composurecdk/apigateway";
import { createRoleBuilder } from "@composurecdk/iam";

compose(
  {
    api: createRestApiBuilder().restApiName("Internal"),
    caller: createRoleBuilder()
      .assumedBy(principal)
      .grant(restApiGrants.invoke(ref("api", (r: RestApiBuilderResult) => r.api))),
  },
  { api: [], caller: ["api"] }, // caller → api; the grant edge follows the data flow
);
```

`restApiGrants.invoke(api)` adds `execute-api:Invoke` on the API's `arnForExecuteApi()` (all methods, paths, and stages). `IRestApi` is implemented by both `RestApi` and `SpecRestApi`, so the same helper serves either builder's result.

Unlike most resources, `IRestApi` exposes no native `grant*` method to delegate to — the grant is assembled from the single `execute-api:Invoke` action plus the construct's own ARN builder ([ADR-0013 addendum](../../docs/adr/0013-consumer-side-grants.md#addendum-2026-07-24-resources-with-no-native-grant-method)).

### Scoping the grant

Pass a `RestApiInvokeScope` to narrow the ARN to a specific method, path, and/or stage; each field defaults to `*`:

```ts
// Only GET /items on the prod stage
restApiGrants.invoke(
  ref("api", (r: RestApiBuilderResult) => r.api),
  {
    method: "GET",
    path: "/items",
    stage: "prod",
  },
);
```

Each field is independent, so any subset yields a partial wildcard — `{ method: "GET" }` allows `GET` on any path and stage, `{ path: "/items" }` allows any method on `/items`. Paths themselves accept `*` (e.g. `{ path: "/items/*" }`), matching the `arn:…:execute-api:…:<api>/<stage>/<method>/<path>` structure.

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

- [CrudApiStack](../examples/src/crud-api-app.ts) — CRUD REST API backed directly by DynamoDB via `AwsIntegration`, with no Lambda in the request path
- [MockApiStack](../examples/src/mock-api-app.ts) — CRUD REST API with mock integrations and recommended alarms with custom thresholds
- [MultiStackApp](../examples/src/multi-stack-app.ts) — REST API + Lambda split across stacks via `.withStacks()`, wired with `ref`
