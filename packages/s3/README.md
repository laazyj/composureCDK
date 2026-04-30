# @composurecdk/s3

S3 builders for [ComposureCDK](../../README.md).

This package provides fluent builders for S3 buckets and bucket deployments with secure, AWS-recommended defaults. It wraps the CDK [Bucket](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html) and [BucketDeployment](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeployment.html) constructs — refer to the CDK documentation for the full set of configurable properties.

## Bucket Builder

```ts
import { createBucketBuilder } from "@composurecdk/s3";

const site = createBucketBuilder().bucketName("my-website-bucket").build(stack, "SiteBucket");
```

Every [BucketProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.BucketProps.html) property is available as a fluent setter on the builder.

### Secure Defaults

`createBucketBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property            | Default               | Rationale                                                                                     |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `serverAccessLogs`  | `{ prefix: "logs/" }` | Auto-creates a logging bucket for the server access log audit trail under the `logs/` prefix. |
| `blockPublicAccess` | `BLOCK_ALL`           | Prevents public access unless explicitly required.                                            |
| `encryption`        | `S3_MANAGED`          | Enables server-side encryption with S3-managed keys (SSE-S3).                                 |
| `enforceSSL`        | `true`                | Requires SSL/TLS for all requests to the bucket.                                              |
| `versioned`         | `true`                | Protects against accidental deletions and supports rollback.                                  |
| `removalPolicy`     | `RETAIN`              | Retains the bucket on stack deletion to prevent data loss.                                    |

These defaults are guided by the [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html).

The defaults are exported as `BUCKET_DEFAULTS` for visibility and testing:

```ts
import { BUCKET_DEFAULTS } from "@composurecdk/s3";
```

### Overriding defaults

```ts
import { RemovalPolicy } from "aws-cdk-lib";
import { BlockPublicAccess } from "aws-cdk-lib/aws-s3";

const bucket = createBucketBuilder()
  .blockPublicAccess(BlockPublicAccess.BLOCK_ACLS)
  .versioned(false)
  .removalPolicy(RemovalPolicy.DESTROY)
  .build(stack, "MyBucket");
```

When `removalPolicy` is set to `DESTROY`, the builder automatically enables `autoDeleteObjects` (unless explicitly set to `false`) so that non-empty buckets can be cleanly removed during stack deletion.

### Access logging

Server access logging is configured through a single `.serverAccessLogs(config)` setting. By default, the builder creates a dedicated logging bucket with secure defaults and writes logs under `logs/`. The created bucket is returned in the build result:

```ts
const result = createBucketBuilder().build(stack, "MyBucket");

result.bucket; // Bucket
result.accessLogsBucket; // Bucket | undefined
```

`.serverAccessLogs(config)` accepts either `false` to disable access logging, or an object describing how to handle logs:

```ts
import { Duration } from "aws-cdk-lib";

// Disable access logging entirely
createBucketBuilder().serverAccessLogs(false);

// Auto-create a logging bucket with a custom prefix
createBucketBuilder().serverAccessLogs({ prefix: "audit/" });

// Auto-create and customize the logging sub-builder
createBucketBuilder().serverAccessLogs({
  configure: (sub) => sub.lifecycleRules([{ id: "ShortLogs", expiration: Duration.days(180) }]),
});

// Bring your own destination bucket
createBucketBuilder().serverAccessLogs({ destination: myBucket });

// Bring your own destination with a prefix
createBucketBuilder().serverAccessLogs({ destination: myBucket, prefix: "x/" });
```

`destination` and `configure` cannot be combined — the destination bucket is user-managed and is not built by this builder.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#S3) automatically when [CloudWatch request metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configure-request-metrics-bucket.html) are configured on the bucket via `.metrics()`. One alarm per metric is created for each metrics configuration entry. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm          | Metric                 | Default threshold | Created when               |
| -------------- | ---------------------- | ----------------- | -------------------------- |
| `serverErrors` | 5xxErrors (Sum, 5 min) | > 0               | `.metrics()` is configured |
| `clientErrors` | 4xxErrors (Sum, 5 min) | > 0               | `.metrics()` is configured |

Alarm keys include the metrics filter ID (e.g. `serverErrors:EntireBucket`). When multiple metrics configurations are provided, alarms are created for each one.

The defaults are exported as `BUCKET_ALARM_DEFAULTS` for visibility and testing:

```ts
import { BUCKET_ALARM_DEFAULTS } from "@composurecdk/s3";
```

### Enabling alarms

Configure request metrics on the bucket — alarms are created automatically:

```ts
const site = createBucketBuilder().metrics([{ id: "EntireBucket" }]);
```

### Multiple metrics configurations

Alarms are created for each metrics configuration entry:

```ts
const site = createBucketBuilder().metrics([
  { id: "EntireBucket" },
  { id: "UploadsOnly", prefix: "uploads/" },
]);

// Creates: serverErrors:EntireBucket, clientErrors:EntireBucket,
//          serverErrors:UploadsOnly, clientErrors:UploadsOnly
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
builder.metrics([{ id: "EntireBucket" }]).recommendedAlarms({
  serverErrors: { threshold: 5, evaluationPeriods: 3 },
  clientErrors: { threshold: 50 },
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
builder.metrics([{ id: "EntireBucket" }]).recommendedAlarms({ clientErrors: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to the S3 `Bucket`, so the metric factory has access to the bucket's metric helpers.

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

const site = createBucketBuilder()
  .metrics([{ id: "EntireBucket" }])
  .addAlarm("lowTraffic", (alarm) =>
    alarm
      .metric(
        (bucket) =>
          new Metric({
            namespace: "AWS/S3",
            metricName: "GetRequests",
            dimensionsMap: {
              BucketName: bucket.bucketName,
              FilterId: "EntireBucket",
            },
            period: Duration.minutes(5),
          }),
      )
      .threshold(10)
      .lessThan()
      .description("Bucket traffic has dropped below expected level"),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = site.build(stack, "SiteBucket");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## Bucket Deployment Builder

Deploys local assets to an S3 bucket with optional CloudFront cache invalidation.

```ts
import { createBucketDeploymentBuilder } from "@composurecdk/s3";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

const deploy = createBucketDeploymentBuilder()
  .sources([Source.asset("./site")])
  .destinationBucket(myBucket)
  .build(stack, "Deploy");
```

The `destinationBucket` and `distribution` methods accept `Ref` values for cross-component wiring:

```ts
import { compose, ref } from "@composurecdk/core";

const deploy = createBucketDeploymentBuilder()
  .sources([Source.asset("./site")])
  .destinationBucket(ref("site", (r) => r.bucket))
  .distribution(ref("cdn", (r) => r.distribution));

compose(
  { site: createBucketBuilder(), cdn: createDistributionBuilder(), deploy },
  { site: [], cdn: ["site"], deploy: ["site", "cdn"] },
).build(stack, "Website");
```

### Secure Defaults

`createBucketDeploymentBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property            | Default  | Rationale                                                                                                           |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `prune`             | `true`   | Removes stale files from the destination, keeping it in sync with the source.                                       |
| `memoryLimit`       | `256`    | Allocates 256 MiB to the deployment Lambda (CDK default of 128 MiB is insufficient for larger deployments).         |
| `retainOnDelete`    | `false`  | Does not retain deployed files on stack deletion, consistent with prune semantics.                                  |
| `distributionPaths` | `["/*"]` | Invalidates all CloudFront paths so content is immediately visible. Only applied when a distribution is configured. |

The builder also auto-creates a managed CloudWatch LogGroup (using `@composurecdk/logs` with its secure defaults) for the deployment's backing Lambda, preventing the auto-created log group with infinite retention.

The defaults are exported as `BUCKET_DEPLOYMENT_DEFAULTS` for visibility and testing:

```ts
import { BUCKET_DEPLOYMENT_DEFAULTS } from "@composurecdk/s3";
```

## Examples

- [StaticWebsiteStack](../examples/src/static-website/app.ts) — S3 + CloudFront static website with OAC, error pages, and content deployment
