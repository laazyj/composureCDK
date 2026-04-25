# @composurecdk/route53

Route 53 hosted zone and record builders for [ComposureCDK](../../README.md).

This package provides fluent builders for Route 53 public hosted zones and for the record types most commonly needed when fronting an AWS workload (A/AAAA alias, CNAME, TXT, MX, SRV, CAA, NS, DS, HTTPS, SVCB). It wraps the CDK [aws-route53](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html) constructs — refer to the CDK documentation for the full set of configurable properties.

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

Route 53 is a global service, but DNS query logs are emitted in `us-east-1` only — the CloudWatch log group that receives them must live there regardless of where the hosted zone is declared. This is an AWS service constraint, not a restriction on where your hosted zone or records can live.

Supply a pre-configured log group via `.queryLogsLogGroupArn(arn)`. The log group must:

- Be in `us-east-1`.
- Have a resource policy granting `route53.amazonaws.com` permission to `logs:PutLogEvents` and `logs:CreateLogStream`.

Auto-creating the log group and resource policy on the user's behalf is planned — see [#44](https://github.com/laazyj/composureCDK/issues/44). Once implemented, enabling query logging will become a single opt-in property with the log group + resource policy wired by default.

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

For AWS-service records, prefer A/AAAA alias records over CNAMEs. Alias records:

- Are free to resolve (CNAMEs are billed per query).
- Work at the zone apex (CNAMEs cannot coexist with the mandatory apex SOA/NS records).
- Resolve in a single hop (CNAMEs chain to a second lookup).
- Track AWS-managed DNS changes automatically (CNAMEs must be updated manually if the target's DNS name changes).
- Support both IPv4 (A) and IPv6 (AAAA) from the same alias target.

Use `createCnameRecordBuilder` only when the target is not an AWS resource (or the AWS resource does not expose an alias target), and never at the zone apex.

| Helper                                | Points at                                        |
| ------------------------------------- | ------------------------------------------------ |
| `cloudfrontAliasTarget(distribution)` | A `cloudfront.IDistribution`                     |
| `apiGatewayAliasTarget(api)`          | An `apigateway.RestApiBase` with a custom domain |
| `apiGatewayDomainAliasTarget(domain)` | A shared `apigateway.DomainName`                 |

Each helper accepts a `Resolvable`, so targets produced by other composed components (e.g. `@composurecdk/cloudfront`) can be wired in via `ref()`.

## Secure Defaults

| Builder                    | Property         | Default               | Rationale                                                                                |
| -------------------------- | ---------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `createHostedZoneBuilder`  | `addTrailingDot` | `true`                | Matches RFC 1035 and the CDK default; unambiguous apex.                                  |
| `createARecordBuilder`     | `ttl`            | `Duration.minutes(5)` | Balances propagation latency against DNS cache churn; skipped for alias targets.[^alias] |
| `createAaaaRecordBuilder`  | `ttl`            | `Duration.minutes(5)` | Same as A records; skipped for alias targets.[^alias]                                    |
| `createCnameRecordBuilder` | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |
| `createTxtRecordBuilder`   | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |
| `createMxRecordBuilder`    | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |
| `createSrvRecordBuilder`   | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |
| `createCaaRecordBuilder`   | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |
| `createNsRecordBuilder`    | `ttl`            | `Duration.hours(24)`  | Delegation records change rarely; long TTL cuts lookups.                                 |
| `createDsRecordBuilder`    | `ttl`            | `Duration.hours(24)`  | DNSSEC trust anchors change on key rollover only.                                        |
| `createHttpsRecordBuilder` | `ttl`            | `Duration.minutes(5)` | Same as A records; skipped for alias targets.[^alias]                                    |
| `createSvcbRecordBuilder`  | `ttl`            | `Duration.minutes(5)` | Same rationale as A records.                                                             |

The defaults are exported as `HOSTED_ZONE_DEFAULTS`, `A_RECORD_DEFAULTS`, `AAAA_RECORD_DEFAULTS`, `CNAME_RECORD_DEFAULTS`, `TXT_RECORD_DEFAULTS`, `MX_RECORD_DEFAULTS`, `SRV_RECORD_DEFAULTS`, `CAA_RECORD_DEFAULTS`, `NS_RECORD_DEFAULTS`, `DS_RECORD_DEFAULTS`, `HTTPS_RECORD_DEFAULTS`, and `SVCB_RECORD_DEFAULTS` for visibility and testing.

[^alias]: AWS ignores TTL on alias records and CDK emits a warning when one is set, so `A`, `AAAA`, and `HTTPS` builders skip the default TTL whenever the target is an alias.

## Health Check Builder

```ts
import { HealthCheckType } from "aws-cdk-lib/aws-route53";
import { createHealthCheckBuilder } from "@composurecdk/route53";

createHealthCheckBuilder()
  .type(HealthCheckType.HTTPS)
  .fqdn("api.example.com")
  .resourcePath("/health")
  .build(stack, "ApiHealthCheck");
```

Every [HealthCheckProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53.HealthCheckProps.html) property is available as a fluent setter on the builder.

### Health-check defaults

| Property           | Default                | Rationale                                                                                                                                                                                |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failureThreshold` | `3`                    | AWS guidance — three consecutive failures avoids flapping from transient endpoint hiccups.                                                                                               |
| `requestInterval`  | `Duration.seconds(30)` | Standard health check; matches the CDK default.                                                                                                                                          |
| `measureLatency`   | `true`                 | Per-region latency visibility on the Health Checks console; aligns with the Well-Architected operational-excellence pillar. Set `.measureLatency(false)` to opt out (small cost saving). |

Exported as `HEALTH_CHECK_DEFAULTS` for visibility and testing.

### Recommended Alarms

The builder creates the [AWS-recommended](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53) `HealthCheckStatus` alarm by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions, or use [`alarmActionsPolicy`](../cloudwatch/README.md#alarm-actions-policy) for stack-wide wiring.

| Alarm               | Metric                                | Default threshold |
| ------------------- | ------------------------------------- | ----------------- |
| `healthCheckStatus` | HealthCheckStatus (Minimum, 1 minute) | `< 1`             |

`treatMissingData` defaults to `breaching`: missing datapoints are treated as unhealthy, matching the AWS example. This guards against the metric stopping emission while downstream systems still depend on the health check.

The defaults are exported as `HEALTH_CHECK_ALARM_DEFAULTS` for visibility and testing:

```ts
import { HEALTH_CHECK_ALARM_DEFAULTS } from "@composurecdk/route53";
```

#### Customising thresholds

```ts
createHealthCheckBuilder()
  .type(HealthCheckType.HTTPS)
  .fqdn("api.example.com")
  .recommendedAlarms({ healthCheckStatus: { evaluationPeriods: 2 } });
```

#### Disabling alarms

Disable the recommended alarm with `recommendedAlarms({ healthCheckStatus: false })`, or disable all recommended alarms with `recommendedAlarms(false)`. Custom alarms attached via `addAlarm` are unaffected by either form.

#### Custom alarms

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";

createHealthCheckBuilder()
  .type(HealthCheckType.HTTPS)
  .fqdn("api.example.com")
  .addAlarm("connectionTime", (a) =>
    a
      .metric(
        (hc) =>
          new Metric({
            namespace: "AWS/Route53",
            metricName: "ConnectionTime",
            dimensionsMap: { HealthCheckId: hc.healthCheckId },
            statistic: "Average",
          }),
      )
      .threshold(2000)
      .greaterThan(),
  );
```

#### Applying alarm actions

No alarm actions are configured by default. Wire SNS or other actions via `alarmActionsPolicy` (or an `afterBuild` hook) — for cross-region deployments, the policy applied to the `us-east-1` monitoring stack covers both recommended and custom alarms.

### Cross-region: `AWS/Route53` metrics live in `us-east-1` only

Route 53 publishes its CloudWatch metrics in `us-east-1` regardless of where the health check is created. CloudWatch alarms are regional, so an alarm in any other region will never receive data. The combined builder emits a synth-time warning (`@composurecdk/route53:alarm-region`) when used outside `us-east-1`, but the better approach is to route the alarm into a `us-east-1` stack via `createHealthCheckAlarmBuilder` and `compose().withStacks()`:

```ts
import { compose, ref } from "@composurecdk/core";
import { HealthCheckType } from "aws-cdk-lib/aws-route53";
import {
  createHealthCheckBuilder,
  createHealthCheckAlarmBuilder,
  type HealthCheckBuilderResult,
} from "@composurecdk/route53";

compose(
  {
    api: createHealthCheckBuilder()
      .type(HealthCheckType.HTTPS)
      .fqdn("api.example.com")
      .recommendedAlarms(false), // suppress alarms in the api's own stack

    apiAlarms: createHealthCheckAlarmBuilder().healthCheck(ref<HealthCheckBuilderResult>("api")),
  },
  { api: [], apiAlarms: ["api"] },
)
  .withStacks({
    api: appStack, //         any region — Route 53 health checks are global
    apiAlarms: monitoringStack, // us-east-1 — where AWS/Route53 metrics live
  })
  .build(app, "App");
```

Set `crossRegionReferences: true` on both stacks so CDK can export the `HealthCheckId` from the app stack and import it in the alarm stack. The same pattern is documented for CloudFront alarms ([#58](https://github.com/laazyj/composureCDK/pull/58)) and codified in [ADR-0004](../../docs/adr/0004-split-alarm-builder-for-fixed-region-metrics.md).

## Zone DSL

Individual builders are convenient for AWS-service records wired to other constructs, but a real zone file — apex, www, mail, SPF/DMARC/DKIM, CAA, service records — is faster to read and write as a flat list of records. `@composurecdk/route53/zone` exposes a BIND-style DSL that compiles to the same builders:

```ts
import { compose, ref } from "@composurecdk/core";
import type { DistributionBuilderResult } from "@composurecdk/cloudfront";
import {
  cloudfrontAliasTarget,
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";
import {
  A,
  AAAA,
  ALIAS,
  APEX,
  CAA_ISSUE,
  CAA_ISSUEWILD,
  CNAME,
  MX,
  SRV,
  TXT,
  zoneRecords,
} from "@composurecdk/route53/zone";

compose(
  {
    zone: createHostedZoneBuilder().zoneName("example.com"),
    records: zoneRecords([
      A(APEX, "203.0.113.10"),
      AAAA(APEX, "2001:db8::10"),
      A("api", ["203.0.113.20", "203.0.113.21"]),

      ALIAS(
        "www",
        cloudfrontAliasTarget(ref<DistributionBuilderResult>("cdn").get("distribution")),
      ),
      ALIAS(
        "www",
        cloudfrontAliasTarget(ref<DistributionBuilderResult>("cdn").get("distribution")),
        {
          ipv6: true,
        },
      ),

      MX(APEX, 10, "mail1.example.com."),
      MX(APEX, 20, "mail2.example.com."),
      TXT(APEX, "v=spf1 mx -all"),
      TXT("_dmarc", "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"),
      CNAME("k1._domainkey", "k1.dkim.esp.example.net."),

      SRV("_sip._tcp", 10, 60, 5060, "sip1.example.com."),

      CAA_ISSUE(APEX, "amazon.com"),
      CAA_ISSUEWILD(APEX, "amazon.com"),
    ]).zone(ref<HostedZoneBuilderResult>("zone").get("hostedZone")),
  },
  { zone: [], records: ["zone"] },
).build(stack, "DNS");
```

### Helpers

| Helper                                       | Shape                 | Notes                                                                                                                                              |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A(name, addr \| addrs, opts?)`              | IPv4 addresses        | Repeat calls merge; use `APEX` for `@`                                                                                                             |
| `AAAA(name, addr \| addrs, opts?)`           | IPv6 addresses        | As `A`                                                                                                                                             |
| `ALIAS(name, target, opts?)`                 | A/AAAA alias record   | `opts.ipv6: true` emits AAAA; pair with helpers from [Alias targets](#alias-targets); cannot coexist with address-mode `A`/`AAAA` at the same name |
| `CNAME(name, target, opts?)`                 | One canonical target  | Duplicate or apex CNAME is rejected                                                                                                                |
| `TXT(name, value \| values, opts?)`          | One or more strings   | Repeat calls merge                                                                                                                                 |
| `MX(name, prio, host, opts?)`                | Mail exchanger        | Repeat calls merge `(priority, hostName)` pairs                                                                                                    |
| `SRV(name, prio, weight, port, host, opts?)` | Service locator       | BIND order; repeat calls merge                                                                                                                     |
| `CAA(name, flag, tag, value, opts?)`         | Raw CAA               | Prefer the wrappers below                                                                                                                          |
| `CAA_ISSUE(name, ca, opts?)`                 | `0 issue "ca"`        | Authorize a CA                                                                                                                                     |
| `CAA_ISSUEWILD(name, ca, opts?)`             | `0 issuewild "ca"`    | Authorize a CA for wildcards                                                                                                                       |
| `CAA_IODEF(name, url, opts?)`                | `0 iodef "url"`       | Report policy violations                                                                                                                           |
| `NS(name, host \| hosts, opts?)`             | Delegation            | Apex NS is rejected (managed by Route 53)                                                                                                          |
| `DS(name, rdata \| rdatas, opts?)`           | DNSSEC chain-of-trust | Each value is a full `keyTag alg digestType digest` rdata                                                                                          |
| `HTTPS(name, value \| values, opts?)`        | RFC 9460 HTTPS record | Accepts `HttpsRecordValue.alias()`/`.service()` from the CDK                                                                                       |
| `SVCB(name, value \| values, opts?)`         | RFC 9460 generic SVCB | As `HTTPS`; for web traffic prefer `HTTPS`                                                                                                         |

The trailing `opts` argument is `{ ttl?, comment? }`. When records with the same `(type, name)` are merged, the **first defined** `ttl`/`comment` in declaration order wins — so to give a merged group a TTL or comment, attach it to the first call:

```ts
// TTL of 10m applies to the whole merged RR-set. The later calls inherit it.
A("api", "203.0.113.20", { ttl: Duration.minutes(10), comment: "primary" }),
A("api", "203.0.113.21"),
A("api", "203.0.113.22"),
```

Putting the TTL on a later call is silently ignored if an earlier call in the group already has one — this keeps merge output deterministic regardless of how the list is reordered.

### APEX sentinel

`APEX` (= `"@"`) stands in for the zone's own name, matching BIND zone-file convention. When records are bound to CDK the sentinel is translated to an undefined `recordName`, so CDK emits them at the zone apex.

### RR-set merge semantics

DNS resolvers see one record set per `(type, name)`, so the DSL groups every call sharing `(type, name)` into a single CDK record. Repeated `A`, `AAAA`, `TXT`, `MX`, `SRV`, `CAA`, `NS`, `DS`, `HTTPS`, and `SVCB` calls for the same name are merged; the order of values within the merged set matches the order of the DSL calls.

Exact-duplicate string values (same IP appearing twice in an `A` merge, the same TXT string, the same NS hostname) are de-duplicated during merge — DNS RR-sets never want identical values and CDK rejects them with an opaque error. Structured values (MX `(priority, host)` pairs, SRV, CAA, HTTPS/SVCB) are passed through as given.

### Errors surfaced at build time

- `CNAME` at the apex — DNS forbids CNAMEs from coexisting with the mandatory apex SOA/NS records. Use an A/AAAA alias instead.
- More than one `CNAME` for the same name — DNS allows at most one CNAME per name.
- `NS` at the apex — Route 53 manages the apex NS set itself; recreating it clashes with the zone's delegation.
- `ALIAS` mixed with address-mode `A`/`AAAA` at the same name — DNS allows only one record set per `(type, name)`. Pick alias or addresses, not both.
- More than one `ALIAS` for the same `(type, name)` — DNS allows one alias record per name+type. To dual-stack, call `ALIAS` once and once more with `{ ipv6: true }`.
- `zoneRecords(...).build(...)` without a `.zone(...)` call.

### HTTPS / SVCB alias mode

The DSL supports value-mode HTTPS/SVCB records (fixed advertised parameters). For alias-mode records — typically pointing at a CloudFront distribution — use `createHttpsRecordBuilder().target(cloudfrontAliasTarget(dist))` directly; `HTTPS(...)` is intentionally value-mode only to keep the DSL's merge semantics consistent.

### Worked example

A production-like zone with every record type is demonstrated in [`packages/examples/src/dns-zone-app.ts`](../examples/src/dns-zone-app.ts).

## Composing with ACM and CloudFront

```ts
import { compose, ref } from "@composurecdk/core";
import { createCertificateBuilder, type CertificateBuilderResult } from "@composurecdk/acm";
import {
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import {
  cloudfrontAliasTarget,
  createHostedZoneBuilder,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";
import { ALIAS, APEX, zoneRecords } from "@composurecdk/route53/zone";

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
    records: zoneRecords([
      ALIAS(APEX, cloudfrontAliasTarget(ref<DistributionBuilderResult>("cdn").get("distribution"))),
      ALIAS(
        APEX,
        cloudfrontAliasTarget(ref<DistributionBuilderResult>("cdn").get("distribution")),
        {
          ipv6: true,
        },
      ),
    ]).zone(ref<HostedZoneBuilderResult>("zone").get("hostedZone")),
  },
  { zone: [], cert: ["zone"], cdn: ["cert"], records: ["zone", "cdn"] },
).build(stack, "Site");
```
