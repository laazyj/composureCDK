# @composurecdk/route53

Route 53 hosted zone and record builders for [ComposureCDK](../../README.md).

This package provides fluent builders for Route 53 public hosted zones and for the record types most commonly needed when fronting an AWS workload (A/AAAA alias, CNAME, TXT). It wraps the CDK [aws-route53](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html) constructs — refer to the CDK documentation for the full set of configurable properties.

## Hosted Zone Builder

```ts
import { createHostedZoneBuilder } from "@composurecdk/route53";

const zone = createHostedZoneBuilder()
  .zoneName("example.com")
  .comment("Primary customer-facing domain")
  .build(stack, "SiteZone");
```

Every [PublicHostedZoneProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53.PublicHostedZoneProps.html) property is available as a fluent setter on the builder.

### Query logging

Route 53 query logs must be written to a CloudWatch log group in `us-east-1` with a resource policy granting `route53.amazonaws.com`. The builder does not auto-create this log group today — supply one via `.queryLogsLogGroupArn(arn)`.

## Record Builders

```ts
import {
  createARecordBuilder,
  createAaaaRecordBuilder,
  createCnameRecordBuilder,
  createTxtRecordBuilder,
  cloudfrontAliasTarget,
} from "@composurecdk/route53";

createARecordBuilder()
  .zone(zone)
  .target(cloudfrontAliasTarget(distribution))
  .build(stack, "ApexAlias");

createTxtRecordBuilder()
  .zone(zone)
  .recordName("_dmarc")
  .values(["v=DMARC1; p=reject"])
  .build(stack, "Dmarc");
```

### Alias targets

For AWS-service alias records, prefer A/AAAA records with an alias target over CNAMEs. Alias records are free, work at the zone apex, and follow AWS-managed DNS changes automatically.

| Helper                                | Points at                                        |
| ------------------------------------- | ------------------------------------------------ |
| `cloudfrontAliasTarget(distribution)` | A `cloudfront.IDistribution`                     |
| `apiGatewayAliasTarget(api)`          | An `apigateway.RestApiBase` with a custom domain |
| `apiGatewayDomainAliasTarget(domain)` | A shared `apigateway.DomainName`                 |

Each helper accepts a `Resolvable`, so targets produced by other composed components (e.g. `@composurecdk/cloudfront`) can be wired in via `ref()`.

## Secure Defaults

| Builder                    | Property         | Default               | Rationale                                               |
| -------------------------- | ---------------- | --------------------- | ------------------------------------------------------- |
| `createHostedZoneBuilder`  | `addTrailingDot` | `true`                | Matches RFC 1035 and the CDK default; unambiguous apex. |
| `createARecordBuilder`     | `ttl`            | `Duration.minutes(5)` | Balances propagation latency against DNS cache churn.   |
| `createAaaaRecordBuilder`  | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                            |
| `createCnameRecordBuilder` | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                            |
| `createTxtRecordBuilder`   | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                            |

The defaults are exported as `HOSTED_ZONE_DEFAULTS`, `A_RECORD_DEFAULTS`, `AAAA_RECORD_DEFAULTS`, `CNAME_RECORD_DEFAULTS`, and `TXT_RECORD_DEFAULTS` for visibility and testing.

## Composing with ACM and CloudFront

```ts
import { compose, ref } from "@composurecdk/core";
import { createCertificateBuilder, type CertificateBuilderResult } from "@composurecdk/acm";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import {
  createHostedZoneBuilder,
  createARecordBuilder,
  cloudfrontAliasTarget,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";

compose(
  {
    zone: createHostedZoneBuilder().zoneName("example.com"),
    cert: createCertificateBuilder()
      .domainName("example.com")
      .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone)),
    cdn: createDistributionBuilder()
      .domainNames(["example.com"])
      .certificate(ref("cert", (r: CertificateBuilderResult) => r.certificate))
      .origin(/* ... */),
    apex: createARecordBuilder()
      .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
      .target(cloudfrontAliasTarget(ref("cdn", (r: DistributionBuilderResult) => r.distribution))),
  },
  { zone: [], cert: ["zone"], cdn: ["cert"], apex: ["zone", "cdn"] },
).build(stack, "Site");
```
