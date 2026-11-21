# @composurecdk/cloudfront

CloudFront builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for CloudFront distributions with secure, AWS-recommended defaults. It wraps the CDK [Distribution](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.Distribution.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Distribution Builder

```ts
import { createDistributionBuilder } from "@composurecdk/cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";

const cdn = createDistributionBuilder()
  .origin(S3BucketOrigin.withOriginAccessControl(bucket))
  .comment("My website CDN")
  .build(stack, "CDN");
```

Every [DistributionProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.DistributionProps.html) property (except `defaultBehavior.origin`) is available as a fluent setter on the builder. The origin is set via the dedicated `.origin()` method, which supports `Ref` for cross-component wiring.

### Cross-component wiring

The `origin` method accepts a `Ref` for use in composed systems:

```ts
import { compose, ref } from "@composurecdk/core";
import type { BucketBuilderResult } from "@composurecdk/s3";

const cdn = createDistributionBuilder().origin(
  ref<BucketBuilderResult>("site", (r) => S3BucketOrigin.withOriginAccessControl(r.bucket)),
);

compose({ site: createBucketBuilder(), cdn }, { site: [], cdn: ["site"] }).build(stack, "Website");
```

`.certificate(...)` takes a `Ref` the same way, so an [`@composurecdk/acm`](../acm/README.md) certificate (issued in `us-east-1`) can be a component of the same system. Its inner type is read from CDK's own `DistributionProps.certificate` rather than pinned to `ICertificate`, so it accepts whatever the `aws-cdk-lib` you have installed accepts — including the broader [`acm.ICertificateRef`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.ICertificateRef.html) where CDK has widened the prop.

## Secure Defaults

`createDistributionBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                                | Default               | Rationale                                                                                                                                                                                                   |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessLogs`                            | `{ prefix: "logs/" }` | Auto-creates an S3 logging bucket for the access log audit trail under the `logs/` prefix. Uses legacy logging, which needs ACLs; see [Standard logging (v2)](#standard-logging-v2) for an ACL-free bucket. |
| `priceClass`                            | `PRICE_CLASS_100`     | North America and Europe edge locations — sufficient and cost-effective.                                                                                                                                    |
| `httpVersion`                           | `HTTP2_AND_3`         | Enables HTTP/2 and HTTP/3 (QUIC) for improved performance.                                                                                                                                                  |
| `defaultRootObject`                     | `"index.html"`        | Standard for static website hosting.                                                                                                                                                                        |
| `minimumProtocolVersion`                | `TLS_V1_2_2021`       | Requires TLS 1.2+. Applied only with a custom `certificate`; see below.                                                                                                                                     |
| `defaultBehavior.viewerProtocolPolicy`  | `REDIRECT_TO_HTTPS`   | Ensures all viewer traffic is encrypted in transit.                                                                                                                                                         |
| `defaultBehavior.responseHeadersPolicy` | `SECURITY_HEADERS`    | Applies managed security headers (HSTS, X-Content-Type-Options, etc.).                                                                                                                                      |

A TLS floor needs a custom domain and certificate: the default `*.cloudfront.net` certificate's security policy is fixed, so without `.certificate(...)` the `minimumProtocolVersion` default is not applied (CDK would ignore it and warn). A `minimumProtocolVersion` you set yourself is always passed through.

Path behaviors added with `.behavior(pathPattern, config)` get the same `viewerProtocolPolicy` and `responseHeadersPolicy` defaults, exported as `BEHAVIOR_DEFAULTS`; override either per behavior.

These defaults are guided by the [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-in-transit.html).

The defaults are exported as `DISTRIBUTION_DEFAULTS` for visibility and testing:

```ts
import { DISTRIBUTION_DEFAULTS } from "@composurecdk/cloudfront";
```

### Overriding defaults

```ts
import { PriceClass, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";

const cdn = createDistributionBuilder()
  .origin(myOrigin)
  .priceClass(PriceClass.PRICE_CLASS_ALL)
  .accessLogs(false)
  .defaultBehavior({ viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL })
  .build(stack, "CDN");
```

### Access logging

CloudFront access logging is configured through a single `.accessLogs(config)` setting. By default, the builder uses CloudFront's **legacy** standard logging: it creates a dedicated logging bucket (using `@composurecdk/s3` with its secure defaults, plus `BUCKET_OWNER_PREFERRED` object ownership) and writes logs under `logs/`. The created bucket is returned in the build result:

```ts
const result = createDistributionBuilder().origin(myOrigin).build(stack, "CDN");

result.distribution; // Distribution
result.accessLogsBucket; // Bucket | undefined
```

> [!IMPORTANT]
> Legacy logging writes through bucket ACLs, so its bucket must have ACLs enabled. Where a guardrail requires `BucketOwnerEnforced` on every bucket, use [standard logging (v2)](#standard-logging-v2) instead.

`.accessLogs(config)` accepts `false` to disable access logging, `{ v2: {...} }` for [standard logging (v2)](#standard-logging-v2), or an object describing how to handle legacy logs:

```ts
import { Duration } from "aws-cdk-lib";

// Disable access logging entirely
createDistributionBuilder().origin(myOrigin).accessLogs(false);

// Auto-create a logging bucket with a custom prefix
createDistributionBuilder().origin(myOrigin).accessLogs({ prefix: "cdn/" });

// Include cookies in the logs
createDistributionBuilder().origin(myOrigin).accessLogs({ includeCookies: true });

// Auto-create and customize the logging sub-builder
createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({
    configure: (sub) => sub.lifecycleRules([{ id: "ShortLogs", expiration: Duration.days(180) }]),
  });

// Bring your own destination bucket
createDistributionBuilder().origin(myOrigin).accessLogs({ destination: myBucket });

// Bring your own destination with a prefix and cookies
createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({ destination: myBucket, prefix: "cdn/", includeCookies: true });
```

`destination` and `configure` cannot be combined — the destination bucket is user-managed and is not built by this builder.

The `configure` callback receives the build context, so anything `IBucketBuilder` accepts as a `Resolvable` can be a `ref` to a sibling — an `@composurecdk/kms` key for `encryptionKey`, for instance. Declare that component as a dependency of the distribution.

The config object replaces the default wholesale rather than merging with it. For example, `.accessLogs({ includeCookies: true })` does **not** preserve the default `prefix: "logs/"` — restate any default you want to keep.

The auto-created logging bucket uses `DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES` from `@composurecdk/s3`: incomplete multipart uploads are aborted after 7 days and access log objects expire after 2 years (matching the default `LogGroup` retention so the audit window is consistent across log destinations). CloudFront never deletes its own logs, so this lifecycle is the only thing that bounds the bucket's growth.

### Standard logging (v2)

`.accessLogs({ v2: {...} })` uses CloudFront's [standard logging (v2)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html), which delivers through CloudWatch Logs vended-log delivery (`AWS::Logs::DeliverySource`, `AWS::Logs::DeliveryDestination` and `AWS::Logs::Delivery`). Its S3 destination is granted through the bucket policy, so the bucket keeps ACLs disabled.

The delivery is built in the distribution's stack by a delivery builder (`ICloudFrontLogDeliveryBuilder`), and `configure` customizes it. Its options are listed below; `includeCookies` sits beside `configure` because it is a setting on the distribution.

```ts
// Auto-create an ACL-free bucket (the default destination)
createDistributionBuilder().origin(myOrigin).accessLogs({ v2: {} });

// Customize the bucket, the key prefix and the delivery
createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({
    v2: {
      configure: (d) =>
        d
          .destination({
            s3: {
              prefix: "cdn",
              configure: (sub) =>
                sub.lifecycleRules([{ id: "ShortLogs", expiration: Duration.days(180) }]),
            },
          })
          .outputFormat("parquet"),
      includeCookies: true,
    },
  });

// Bring your own bucket (any region) or a log group (us-east-1)
createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({ v2: { configure: (d) => d.destination({ s3: { bucket: myBucket } }) } });

// Deliver to a delivery destination you manage: Firehose, cross-account, …
createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({
    v2: { configure: (d) => d.destination({ deliveryDestinationArn: myDestinationArn }) },
  });
```

In a composed system, the destination can be a sibling component, passed by `ref`. Declare it as a dependency of the distribution:

```ts
compose(
  {
    // Server access logging off: a log bucket needs no log bucket of its own.
    logs: createBucketBuilder().serverAccessLogs(false),
    cdn: createDistributionBuilder()
      .origin(myOrigin)
      .accessLogs({
        v2: {
          configure: (d) =>
            d.destination({ s3: { bucket: ref("logs", (r: BucketBuilderResult) => r.bucket) } }),
        },
      }),
  },
  { logs: [], cdn: ["logs"] },
);
```

A log group from `@composurecdk/logs` plugs in the same way, as `d.destination({ logGroup: ref("logs", (r: LogGroupBuilderResult) => r.logGroup) })`.

The build result's `logDelivery` holds the delivery source, destination and delivery, and `accessLogsBucket` holds the bucket when the builder created one.

The builder's options are only those it needs to know about. The delivery's other settings — the record fields, field delimiter and S3 partitioning suffix — change nothing the builder creates, so set them on the `CfnDelivery` in `logDelivery.delivery`, which is typed by the aws-cdk-lib you have installed:

```ts
const { logDelivery } = createDistributionBuilder()
  .origin(myOrigin)
  .accessLogs({ v2: {} })
  .build(stack, "CDN");
logDelivery?.delivery.addPropertyOverride("S3SuffixPath", "{DistributionId}/{yyyy}/{MM}/{dd}");
// On aws-cdk-lib 2.167.0 or later, the typed setters work too:
// logDelivery.delivery.recordFields = ["date", "time", "c-ip"];
```

| Option                          | Default        | Notes                                                                                                                                                                     |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.destination()`                | `{ s3: {} }`   | `{ s3 }`, `{ logGroup }` or `{ deliveryDestinationArn }`.                                                                                                                 |
| `.outputFormat()`               | `"w3c"` for S3 | `json`, `plain`, `w3c`, `raw` or `parquet` (S3 only; CloudWatch charges for the conversion), or any format AWS adds later. Changing it replaces the delivery destination. |
| `.s3EnableHiveCompatiblePath()` | `false`        | S3 only. Hive-compatible object paths. An option because, without a prefix, it changes the path the bucket policy grants.                                                 |
| `includeCookies`                | `false`        | On `{ v2 }`, not the builder. Rendered on the distribution: cookie logging is a distribution-wide setting.                                                                |

#### The auto-created bucket

The bucket is built by `@composurecdk/s3` with `BUCKET_OWNER_ENFORCED` object ownership set explicitly, versioning off, `RemovalPolicy.RETAIN`, server access logging off, and the same `DEFAULT_ACCESS_LOG_BUCKET_LIFECYCLE_RULES` as the legacy bucket. `s3.configure` customizes it, as `configure` does for legacy logging. It is created at `<id>LogDelivery/Bucket`, beside the delivery resources, not at the legacy `<id>AccessLogs`: a legacy bucket can't be switched to `BucketOwnerEnforced` in place, because CloudFront adds its log-delivery grant to the bucket ACL outside CloudFormation. Moving an existing distribution from legacy to v2 therefore creates a new bucket; the legacy one is retained with its logs.

Without `s3.prefix`, CloudFront writes under `AWSLogs/<account-id>/CloudFront/`. A prefix **replaces** that path rather than preceding it.

#### Permissions

- **S3.** The builder adds a statement to the bucket's policy allowing `delivery.logs.amazonaws.com` to `s3:PutObject` under the log path, conditioned on `s3:x-amz-acl: bucket-owner-full-control`, `aws:SourceAccount` and the delivery source's ARN. It is written into the template on purpose: left out, CloudWatch Logs appends it to the bucket policy itself, and the next deploy of the CDK-managed policy removes it again. If the bucket is encrypted with a customer-managed KMS key, the key policy gets a matching statement; SSE-KMS with an AWS-managed key is not supported by vended-log delivery. For an imported bucket or key, you own those policies.
- **CloudWatch Logs.** A log group defined in your app gets a resource policy statement allowing `logs:CreateLogStream` and `logs:PutLogEvents`. Log group resource policies count against a limit of 10 per account and region.
- **`deliveryDestinationArn`.** You own the destination's permissions and its output format, so `outputFormat` is rejected. A Firehose stream must be in `us-east-1` and tagged `LogDeliveryEnabled: true`.

#### Region

CloudWatch Logs accepts a CloudFront delivery source only in `us-east-1`, and the builder creates it next to the distribution, so **the distribution's stack must be deployed in `us-east-1`**. `build()` throws when the stack's region is a known other region. For an env-agnostic stack it checks `CDK_DEFAULT_REGION`, and warns (`@composurecdk/cloudfront:log-delivery-region`) when that is unset. A log group outside `us-east-1` raises the same warning, since CloudFront documents cross-region delivery for S3 only. An S3 bucket may be in any region.

#### Constraints

- A distribution can have only **one** delivery source. The source's name is derived from its construct path so it is never replaced; moving the distribution's construct to another path means removing logging in one deploy and adding it in the next.
- The delivery depends on its destination's constructs (the bucket or log group, with their policies). On stack deletion it is removed first, so a bucket with `autoDeleteObjects` is emptied only once CloudFront has stopped delivering to it.
- S3 bucket names must match `[\w-]`: a bucket name with dots is rejected.
- Legacy and v2 logging can run side by side on one distribution, but not through one builder: `accessLogs` takes one or the other.

### Origin object-expiration guard

An S3 lifecycle rule that expires **current** object versions deletes the very
content the distribution serves. Nothing triggers it — no deployment, no drift —
so the site keeps working until the objects reach the configured age and then
starts returning 404s.

The builder registers a suppressible synth-time warning
(`ORIGIN_OBJECT_EXPIRATION_WARNING_ID`) when a bucket it takes as an origin
carries such a rule:

```ts
createBucketBuilder().lifecycleRules([{ expiration: Duration.days(90) }]);
// DistributionBuilder "cdn": origin bucket "Site/Site/Resource" has lifecycle
// rule "…", which expires current object versions across the whole bucket …
```

The check is deliberately narrow, so it fires only on the unambiguous case:

- **Warns** on an enabled rule with `expiration` or `expirationDate` and no
  `prefix`, `tagFilters`, or object-size filter.
- **Stays quiet** for a rule scoped to a prefix, tag, or size — that is a
  considered act on a known subset, and the guard cannot tell whether the subset
  is served. Scoping an expiry to a prefix that CloudFront does not serve is the
  supported way to age content out of an origin bucket.
- **Stays quiet** for `noncurrentVersionExpiration`, which only ever acts on
  versions already superseded by a newer PUT or a delete marker and so can never
  reach live content. This is what the `@composurecdk/s3` bucket defaults use.
- **Stays quiet** when the relationship is unknowable: an imported origin
  bucket, a bucket in another stack, or a non-S3 origin.

Silence it with
`Annotations.of(stack).acknowledgeWarning(ORIGIN_OBJECT_EXPIRATION_WARNING_ID)`.
The acknowledgement must sit on an **ancestor** of the distribution — the stack
is the natural place — because CDK matches acknowledgements against a node's
ancestor paths, never its own.

L1 property overrides are invisible to the guard:
`cfnBucket.addPropertyOverride("LifecycleConfiguration.Rules", …)` is merged
after Aspects run, so an expiry introduced that way is not seen.

### Listing an S3 origin

Grant the distribution `s3:ListBucket` on its origin so that a missing key returns a 404 rather than a 403. Without it, a 403 error response such as a sign-in redirect also catches missing pages:

```ts
createDistributionBuilder().origin(
  ref<BucketBuilderResult>("site", (r) =>
    S3BucketOrigin.withOriginAccessControl(r.bucket, {
      originAccessLevels: [AccessLevel.READ, AccessLevel.LIST],
    }),
  ),
);
```

CDK warns about `AccessLevel.LIST` (`@aws-cdk/aws-cloudfront-origins:listBucketSecurityRisk`) whatever the distribution's settings, because without a `defaultRootObject` a request for `/` returns the bucket listing. The builder acknowledges that warning on its own distribution when `defaultRootObject` is a concrete, non-empty string, which it is by default (`index.html`). If the root object is unset, empty or an unresolved token, the warning stays. The builder decides from its props, so it does not see an L1 override of `DefaultRootObject`.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CloudFront) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm           | Metric                        | Default threshold | Created when |
| --------------- | ----------------------------- | ----------------- | ------------ |
| `errorRate`     | 5xxErrorRate (Average, 1 min) | > 5 (5%)          | Always       |
| `originLatency` | OriginLatency (p90, 1 min)    | > 5000ms          | Always       |

The `originLatency` alarm requires [additional CloudFront metrics](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/viewing-cloudfront-metrics.html#monitoring-console.distributions-additional) to be enabled on the distribution. With the default `treatMissingData: NOT_BREACHING`, the alarm will not fire when additional metrics are not enabled.

Function-level alarms (FunctionValidationErrors, FunctionExecutionErrors, FunctionThrottles) require per-function dimensions. Use `addAlarm` to add them — see [Custom alarms](#custom-alarms) below.

The defaults are exported as `DISTRIBUTION_ALARM_DEFAULTS` for visibility and testing:

```ts
import { DISTRIBUTION_ALARM_DEFAULTS } from "@composurecdk/cloudfront";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const cdn = createDistributionBuilder()
  .origin(myOrigin)
  .recommendedAlarms({
    errorRate: { threshold: 2, evaluationPeriods: 3 },
    originLatency: { threshold: 3000 },
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
builder.recommendedAlarms({ errorRate: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to the CloudFront `Distribution`.

For function-level alarms, provide the function name dimension:

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

const cdn = createDistributionBuilder()
  .origin(myOrigin)
  .addAlarm("functionErrors", (alarm) =>
    alarm
      .metric(
        (dist) =>
          new Metric({
            namespace: "AWS/CloudFront",
            metricName: "FunctionExecutionErrors",
            dimensionsMap: {
              DistributionId: dist.distributionId,
              FunctionName: "MyViewerRequestFn",
              Region: "Global",
            },
            statistic: "Sum",
            period: Duration.minutes(1),
          }),
      )
      .threshold(0)
      .greaterThan()
      .evaluationPeriods(5)
      .datapointsToAlarm(5)
      .description("CloudFront function execution errors detected"),
  );
```

### Applying alarm actions

Alarms are returned in the build result as `Record<string, Alarm>`:

```ts
const result = cdn.build(stack, "CDN");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## Cross-region alarm builder

CloudFront emits all metrics to `us-east-1` only. CloudWatch alarms are regional, so alarms created in any other region never fire — they exist but receive no data. When the distribution lives in a stack outside `us-east-1`, use `createCloudFrontAlarmBuilder` to put the alarms in a separate `us-east-1` stack.

The standalone builder reads the distribution's result (including the inline-function entries) and produces the same alarm surface — distribution-level recommended alarms, per-function recommended alarms, and any custom `addAlarm` alarms.

```ts
import { compose, ref } from "@composurecdk/core";
import {
  createDistributionBuilder,
  createCloudFrontAlarmBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";

compose(
  {
    cdn: createDistributionBuilder()
      .origin(siteOrigin)
      .defaultBehavior({
        functions: [{ eventType: FunctionEventType.VIEWER_REQUEST, code }],
      })
      .recommendedAlarms(false), // suppress all alarms in the dist's own stack

    cdnAlarms: createCloudFrontAlarmBuilder()
      .distribution(ref<DistributionBuilderResult>("cdn"))
      .recommendedAlarms({ errorRate: { threshold: 2 } })
      .addAlarm("custom4xx", (a) =>
        a
          .metric(
            () =>
              new Metric({
                namespace: "AWS/CloudFront",
                metricName: "4xxErrorRate",
                statistic: "Average",
              }),
          )
          .threshold(5)
          .greaterThan(),
      ),
  },
  { cdn: [], cdnAlarms: ["cdn"] },
)
  .withStacks({
    cdn: siteStack, // e.g. eu-west-2
    cdnAlarms: usEast1Stack, // typically your existing certStack
  })
  .build(app, "App");
```

Set `crossRegionReferences: true` on both stacks so CDK can export `DistributionId` from the site stack and import it in the alarm stack.

`recommendedAlarms: false` on `createDistributionBuilder` is the master kill switch for both distribution-level and per-function recommended alarms. Custom alarms added via `addAlarm` are unaffected — call `.addAlarm()` on the standalone alarm builder if you want those to live in the us-east-1 stack too.

## Examples

- [StaticWebsiteStack](../examples/src/static-website/app.ts) — S3 + CloudFront static website with OAC, error pages, and content deployment
