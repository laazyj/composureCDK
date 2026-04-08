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

| Property            | Default      | Rationale                                                        |
| ------------------- | ------------ | ---------------------------------------------------------------- |
| `accessLogging`     | `true`       | Auto-creates a logging bucket for server access log audit trail. |
| `accessLogsPrefix`  | `"logs/"`    | Default prefix for access log object keys.                       |
| `blockPublicAccess` | `BLOCK_ALL`  | Prevents public access unless explicitly required.               |
| `encryption`        | `S3_MANAGED` | Enables server-side encryption with S3-managed keys (SSE-S3).    |
| `enforceSSL`        | `true`       | Requires SSL/TLS for all requests to the bucket.                 |
| `versioned`         | `true`       | Protects against accidental deletions and supports rollback.     |
| `removalPolicy`     | `RETAIN`     | Retains the bucket on stack deletion to prevent data loss.       |

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

By default, the builder creates a dedicated logging bucket with secure defaults and configures it as the server access logs destination. The created bucket is returned in the build result:

```ts
const result = createBucketBuilder().build(stack, "MyBucket");

result.bucket; // Bucket
result.accessLogsBucket; // Bucket | undefined
```

To provide your own destination instead, set `serverAccessLogsBucket` — the auto-created logging bucket is skipped. To disable access logging entirely, set `.accessLogging(false)`.

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
