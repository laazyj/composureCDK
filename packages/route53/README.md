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

## Recommended Alarms

Route 53 health checks expose a `HealthCheckStatus` metric that [AWS recommends alarming on](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53). This package does not yet expose a `HealthCheckBuilder`; once it does, the recommended alarm will be enabled by default alongside the health check. Tracked in [#45](https://github.com/laazyj/composureCDK/issues/45).

## Zone DSL

Individual builders are convenient for AWS-service records wired to other constructs, but a real zone file — apex, www, mail, SPF/DMARC/DKIM, CAA, service records — is faster to read and write as a flat list of records. `@composurecdk/route53/zone` exposes a BIND-style DSL that compiles to the same builders:

```ts
import { compose, ref } from "@composurecdk/core";
import { createHostedZoneBuilder, type HostedZoneBuilderResult } from "@composurecdk/route53";
import {
  A,
  AAAA,
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

| Helper                                       | Shape                 | Notes                                                        |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `A(name, addr \| addrs, opts?)`              | IPv4 addresses        | Repeat calls merge; use `APEX` for `@`                       |
| `AAAA(name, addr \| addrs, opts?)`           | IPv6 addresses        | As `A`                                                       |
| `CNAME(name, target, opts?)`                 | One canonical target  | Duplicate or apex CNAME is rejected                          |
| `TXT(name, value \| values, opts?)`          | One or more strings   | Repeat calls merge                                           |
| `MX(name, prio, host, opts?)`                | Mail exchanger        | Repeat calls merge `(priority, hostName)` pairs              |
| `SRV(name, prio, weight, port, host, opts?)` | Service locator       | BIND order; repeat calls merge                               |
| `CAA(name, flag, tag, value, opts?)`         | Raw CAA               | Prefer the wrappers below                                    |
| `CAA_ISSUE(name, ca, opts?)`                 | `0 issue "ca"`        | Authorize a CA                                               |
| `CAA_ISSUEWILD(name, ca, opts?)`             | `0 issuewild "ca"`    | Authorize a CA for wildcards                                 |
| `CAA_IODEF(name, url, opts?)`                | `0 iodef "url"`       | Report policy violations                                     |
| `NS(name, host \| hosts, opts?)`             | Delegation            | Apex NS is rejected (managed by Route 53)                    |
| `DS(name, rdata \| rdatas, opts?)`           | DNSSEC chain-of-trust | Each value is a full `keyTag alg digestType digest` rdata    |
| `HTTPS(name, value \| values, opts?)`        | RFC 9460 HTTPS record | Accepts `HttpsRecordValue.alias()`/`.service()` from the CDK |
| `SVCB(name, value \| values, opts?)`         | RFC 9460 generic SVCB | As `HTTPS`; for web traffic prefer `HTTPS`                   |

The trailing `opts` argument is `{ ttl?, comment? }`. When records with the same `(type, name)` are merged, the first defined `ttl`/`comment` in declaration order wins.

### APEX sentinel

`APEX` (= `"@"`) stands in for the zone's own name, matching BIND zone-file convention. When records are bound to CDK the sentinel is translated to an undefined `recordName`, so CDK emits them at the zone apex.

### RR-set merge semantics

DNS resolvers see one record set per `(type, name)`, so the DSL groups every call sharing `(type, name)` into a single CDK record. Repeated `A`, `AAAA`, `TXT`, `MX`, `SRV`, `CAA`, `NS`, `DS`, `HTTPS`, and `SVCB` calls for the same name are merged; the order of values within the merged set matches the order of the DSL calls.

### Errors surfaced at build time

- `CNAME` at the apex — DNS forbids CNAMEs from coexisting with the mandatory apex SOA/NS records. Use an A/AAAA alias instead.
- More than one `CNAME` for the same name — DNS allows at most one CNAME per name.
- `NS` at the apex — Route 53 manages the apex NS set itself; recreating it clashes with the zone's delegation.
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
