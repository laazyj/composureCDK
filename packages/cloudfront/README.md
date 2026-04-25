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

## Secure Defaults

`createDistributionBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                                | Default             | Rationale                                                                |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `accessLogging`                         | `true`              | Auto-creates an S3 logging bucket for access log audit trail.            |
| `priceClass`                            | `PRICE_CLASS_100`   | North America and Europe edge locations — sufficient and cost-effective. |
| `httpVersion`                           | `HTTP2_AND_3`       | Enables HTTP/2 and HTTP/3 (QUIC) for improved performance.               |
| `defaultRootObject`                     | `"index.html"`      | Standard for static website hosting.                                     |
| `minimumProtocolVersion`                | `TLS_V1_2_2021`     | Requires TLS 1.2+ to prevent older, less secure protocol negotiation.    |
| `defaultBehavior.viewerProtocolPolicy`  | `REDIRECT_TO_HTTPS` | Ensures all viewer traffic is encrypted in transit.                      |
| `defaultBehavior.responseHeadersPolicy` | `SECURITY_HEADERS`  | Applies managed security headers (HSTS, X-Content-Type-Options, etc.).   |

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
  .accessLogging(false)
  .defaultBehavior({ viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL })
  .build(stack, "CDN");
```

### Access logging

By default, the builder creates an S3 logging bucket (using `@composurecdk/s3` with its secure defaults) and configures it as the distribution's log destination. The created bucket is returned in the build result:

```ts
const result = createDistributionBuilder().origin(myOrigin).build(stack, "CDN");

result.distribution; // Distribution
result.accessLogsBucket; // Bucket | undefined
```

To provide your own bucket instead, set `logBucket` — the auto-created logging bucket is skipped. To disable access logging entirely, set `.accessLogging(false)`.

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
