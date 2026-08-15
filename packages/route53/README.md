# @composurecdk/route53

Route 53 hosted zone and record builders for [ComposureCDK](../../README.md).

This package provides fluent builders for Route 53 public hosted zones, for the record types most commonly needed when fronting an AWS workload (A/AAAA alias, CNAME, TXT, MX, SRV, CAA, NS, DS, HTTPS, SVCB), and for both halves of a cross-account subdomain delegation. It wraps the CDK [aws-route53](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_route53-readme.html) constructs — refer to the CDK documentation for the full set of configurable properties.

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

**Query logging is enabled by default.** When you call `createHostedZoneBuilder().zoneName("example.com")` the builder auto-provisions:

1. A CloudWatch `LogGroup` named `/aws/route53/<zoneName>` with the `@composurecdk/logs` defaults (`RetentionDays.TWO_YEARS`, `RemovalPolicy.RETAIN`).
2. A single shared `AWS::Logs::ResourcePolicy` per stack — `ComposureCDK-Route53QueryLogging` — granting `route53.amazonaws.com` permission to `logs:CreateLogStream` and `logs:PutLogEvents` against the `/aws/route53/*` prefix. The policy includes the `aws:SourceAccount` confused-deputy condition.
3. The `QueryLoggingConfig` on the hosted zone wired to the auto-created log group's ARN, plus a `DependsOn` so Route 53 cannot race the policy on first write.

Multiple hosted zones in the same stack share the resource policy — you stay well clear of the [10-policy/region soft limit](https://docs.aws.amazon.com/Route53/latest/APIReference/API_CreateQueryLoggingConfig.html). The auto-created log group is exposed as `result.queryLogGroup` for downstream wiring (subscription filters, metric filters).

#### `queryLogging` configuration

```ts
type QueryLoggingConfig =
  | false
  | {
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder; // tweak the auto-created log group
      logGroupArn?: string; // bring your own us-east-1 log group; you own its resource policy
    };
```

Customize the auto-created log group:

```ts
import { RetentionDays } from "aws-cdk-lib/aws-logs";

createHostedZoneBuilder()
  .zoneName("example.com")
  .queryLogging({ configure: (lg) => lg.retention(RetentionDays.SIX_MONTHS) });
```

Bring your own log group (you own the resource policy too):

```ts
createHostedZoneBuilder()
  .zoneName("example.com")
  .queryLogging({ logGroupArn: "arn:aws:logs:us-east-1:111122223333:log-group:/audit/dns" });
```

Disable entirely:

```ts
createHostedZoneBuilder().zoneName("example.com").queryLogging(false);
```

#### `us-east-1` constraint

If the stack's region resolves to a known non-`us-east-1` region, `build()` throws with three remediations: deploy the stack in `us-east-1`, pass `queryLogging({ logGroupArn })`, or set `queryLogging(false)`. Env-agnostic stacks (where the region is an unresolved CDK token) are not blocked. A user-supplied `logGroupArn` outside `us-east-1` emits the synth warning `@composurecdk/route53:query-logging-region` instead of erroring.

#### Cost note

Default-on query logging adds two long-lived resources per stack: the log group (charged per ingested GB and per stored GB after retention) and the resource policy (free). For high-traffic zones consider lowering retention via the `configure` callback or disabling logging on zones with low security/audit value.

## Delegation grants

Handing a subdomain to another account means letting that account write the subdomain's `NS` records into the parent zone. The account's role is the consumer and the zone is the resource, so the grant is declared on the **role**, pointing at the zone via a `ref` — the same consumer-side shape as every other grant in the library ([ADR-0013](../../docs/adr/0013-consumer-side-grants.md)):

```ts
import { compose, ref } from "@composurecdk/core";
import { createRoleBuilder } from "@composurecdk/iam";
import { AccountPrincipal } from "aws-cdk-lib/aws-iam";
import {
  createHostedZoneBuilder,
  hostedZoneGrants,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";

compose(
  {
    rootZone: createHostedZoneBuilder().zoneName("example.com"),

    betaDelegationRole: createRoleBuilder()
      .roleName("delegation-beta")
      .assumedBy(new AccountPrincipal(betaAccountId))
      .grant(
        hostedZoneGrants.delegation(
          ref("rootZone", (r: HostedZoneBuilderResult) => r.hostedZone),
          { delegatedZoneNames: ["beta.example.com"] },
        ),
      ),
  },
  { rootZone: [], betaDelegationRole: ["rootZone"] }, // role → zone; no reverse edge
);
```

`hostedZoneGrants.delegation(zone)` delegates to the zone's native `grantDelegation`, which grants `route53:ChangeResourceRecordSets` on the zone — conditioned to `UPSERT`/`DELETE` of `NS` records — plus `route53:ListHostedZonesByName`. `IHostedZone` is implemented by `PublicHostedZone`, `PrivateHostedZone`, and zones imported via `fromLookup`/`fromHostedZoneAttributes`, so the same helper serves any of them.

**Name the delegated zones.** Without `delegatedZoneNames` the grantee may replace or remove the `NS` records of any name in the parent zone, including delegations belonging to other accounts — one over-broad role is enough to take a sibling account's subdomain offline. Passing the names adds the `route53:ChangeResourceRecordSetsNormalizedRecordNames` condition, confining each role to the subdomain it owns. Each name must be lowercase, carry no trailing dot, and be a subdomain of the granting zone; CDK validates all three at synth.

Publishing the delegated zone's own `NS` records into that parent zone is the other half of this story, and it happens in the child account — see [Cross-account zone delegation](#cross-account-zone-delegation) below.

## Cross-account zone delegation

A delegation spans two accounts and needs a builder in each:

| Account    | Declares                                                      | Builder                                      |
| ---------- | ------------------------------------------------------------- | -------------------------------------------- |
| **Parent** | A role the child may assume to write `NS` records in its zone | `hostedZoneGrants.delegation(...)` on a role |
| **Child**  | Its own zone, and the `NS` records published into the parent  | `createCrossAccountZoneDelegationBuilder()`  |

The two halves meet at one role ARN. The parent's half is the [delegation grant](#delegation-grants) above; the child's is:

```ts
import { compose, ref } from "@composurecdk/core";
import { Duration } from "aws-cdk-lib";
import {
  createHostedZoneBuilder,
  createCrossAccountZoneDelegationBuilder,
  type HostedZoneBuilderResult,
} from "@composurecdk/route53";

compose(
  {
    childZone: createHostedZoneBuilder().zoneName("beta.example.com"),

    parentDelegation: createCrossAccountZoneDelegationBuilder()
      .delegatedZone(ref("childZone", (r: HostedZoneBuilderResult) => r.hostedZone))
      .parentHostedZoneName("example.com")
      // The role the parent account granted, scoped to beta.example.com.
      .delegationRole("arn:aws:iam::111122223333:role/delegation-beta")
      .ttl(Duration.minutes(30)),
  },
  { childZone: [], parentDelegation: ["childZone"] },
);
```

At deploy time a Lambda-backed custom resource assumes the delegation role and `UPSERT`s the child zone's four name servers into the parent zone.

**`delegationRole` takes an ARN.** The role lives in the parent account, so the child stack has nothing to `ref` — passing the ARN saves the `Role.fromRoleArn(...)` line every call site would otherwise repeat. The builder imports it as immutable: this stack assumes the role, it never attaches policies to it. An `IRole`, or a `ref` to either, works for the same-account and same-app cases.

**Name the parent zone, or its id — not both.** `parentHostedZoneName` is the usual choice; reach for `parentHostedZoneId` when the parent account holds several zones with the same name. Setting both, or neither, fails at build time naming both setters.

**The delegated zone must be a public zone created in this stack.** The record forwards `hostedZone.hostedZoneNameServers` to the custom resource, and that attribute is `undefined` for private hosted zones and for zones imported with `fromLookup` / `fromHostedZoneAttributes` or referenced from another stack. CDK would deploy a delegation with an empty `NS` set — a subdomain that resolves nowhere, with no error. The builder fails at build time instead, naming the zone.

### Nothing to tighten on this side

The child half is already least privilege: CDK grants the custom-resource provider `sts:AssumeRole` on exactly the one ARN passed to `delegationRole`, and this builder does not widen it. The lever that decides how much damage that role can do is `delegatedZoneNames` on the parent's grant — see [Delegation grants](#delegation-grants) above, where the unscoped form is the tempting shortcut.

### Provider logging

The delegation record is backed by a Lambda custom resource, and aws-cdk-lib creates that Lambda as a raw `AWS::Lambda::Function` with no `LoggingConfig`. Left alone, the Lambda service creates `/aws/lambda/<generated-name>` on first invocation with **indefinite** retention — a log group no template describes and no `@composurecdk/logs` default reaches.

**The builder brings it under the same defaults as every other log group in the library.** It declares `/aws/lambda/<stackName>-cross-account-zone-delegation` with `RetentionDays.TWO_YEARS` / `RemovalPolicy.RETAIN` and points the provider's `LoggingConfig` at it. The provider is a stack-level singleton, so the log group is one too: every delegation record in the stack shares it, and each build result returns the same handle as `result.providerLogGroup`.

```ts
type DelegationProviderLoggingConfig =
  false | { configure?: (b: ILogGroupBuilder) => ILogGroupBuilder };
```

```ts
createCrossAccountZoneDelegationBuilder()
  // ...
  .providerLogging({ configure: (lg) => lg.retention(RetentionDays.ONE_MONTH) });

// Or leave the provider's logging to the Lambda service:
createCrossAccountZoneDelegationBuilder().providerLogging(false);
```

Because the provider is a singleton, `providerLogging` is a per-record knob over a stack-wide resource. The first delegation record built in the stack settles the log group; a later record that sets `providerLogging` to something else is handed the group it will really log to and warned (`@composurecdk/route53:delegation-provider-logging-conflict`) that its setting had no effect — including `providerLogging(false)`, which cannot remove a group a sibling record already created. Configure it on one record per stack.

Keep any customised name under `/aws/lambda/`. CDK owns the provider's execution role and gives it only `AWSLambdaBasicExecutionRole`, which permits `logs:PutLogEvents` on `/aws/lambda/*` and nothing else — a log group named elsewhere silently receives nothing. The builder emits the synth warning `@composurecdk/route53:delegation-provider-log-group-name` if you move it.

### Operational trade-offs

**`ttl` defaults to two days**, matching CDK. That is right steady-state — delegation records are stable, and a long TTL keeps resolvers off the parent's name servers. It is painful mid-migration: an `NS` change takes up to the _previously published_ TTL to propagate. Lower it to minutes ahead of a planned delegation change, deploy, wait out the old TTL, make the change, then raise it again.

**`removalPolicy` defaults to `DESTROY`**, also matching CDK, and it should stay that way: `RETAIN` leaves a lame delegation pointing at a hosted zone that no longer exists — a subdomain that resolves to failure rather than to nothing, and a takeover surface. Be clear-eyed about what it means, though. The records live in _another account's_ zone, so deleting the child stack reaches across an account boundary to delete them.

**The record is written at deploy time only.** If the child hosted zone is ever replaced, its name servers change and the parent's `NS` records go stale until the next deploy of this stack. Nothing detects that drift.

### What to alarm on

**There is nothing to alarm on for the record itself.** Route 53 publishes no CloudWatch metrics for record sets, and the custom resource runs only at deploy time — a failure there already fails the deployment, so an alarm on the provider Lambda would be noise, not signal. This builder provisions no alarms.

The delegation's practical liveness signal is one layer out, on a **health check** against an endpoint in the delegated zone: it only stays healthy while resolution works end to end through the parent's `NS` records, which makes `HealthCheckStatus` — [AWS's recommended Route 53 alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#Route53) — the check that actually catches a broken delegation. This package already ships it: see [Health Check Builder](#health-check-builder) and [Recommended Alarms](#recommended-alarms). The builder cannot create one for you, since a health check needs an endpoint it has no way to know.

If the delegated zone is DNSSEC-signed, the delegation's `DS` half is the part that breaks, and AWS recommends alarming on `DNSSECInternalFailure` and `DNSSECKeySigningKeysNeedingAction`. This package has no zone-level alarms yet — that is a separate gap, not something this builder covers.

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

| Builder                                   | Property          | Default               | Rationale                                                                                           |
| ----------------------------------------- | ----------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `createHostedZoneBuilder`                 | `addTrailingDot`  | `true`                | Matches RFC 1035 and the CDK default; unambiguous apex.                                             |
| `createHostedZoneBuilder`                 | `queryLogging`    | _auto-managed_        | DNS query logs to a `/aws/route53/<zoneName>` log group with a shared resource policy.              |
| `createARecordBuilder`                    | `ttl`             | `Duration.minutes(5)` | Balances propagation latency against DNS cache churn; skipped for alias targets.[^alias]            |
| `createAaaaRecordBuilder`                 | `ttl`             | `Duration.minutes(5)` | Same as A records; skipped for alias targets.[^alias]                                               |
| `createCnameRecordBuilder`                | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createTxtRecordBuilder`                  | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createMxRecordBuilder`                   | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createSrvRecordBuilder`                  | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createCaaRecordBuilder`                  | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createNsRecordBuilder`                   | `ttl`             | `Duration.hours(24)`  | Delegation records change rarely; long TTL cuts lookups.                                            |
| `createDsRecordBuilder`                   | `ttl`             | `Duration.hours(24)`  | DNSSEC trust anchors change on key rollover only.                                                   |
| `createHttpsRecordBuilder`                | `ttl`             | `Duration.minutes(5)` | Same as A records; skipped for alias targets.[^alias]                                               |
| `createSvcbRecordBuilder`                 | `ttl`             | `Duration.minutes(5)` | Same rationale as A records.                                                                        |
| `createCrossAccountZoneDelegationBuilder` | `ttl`             | `Duration.days(2)`    | Matches CDK; delegation records are stable. [Lower it before a migration.](#operational-trade-offs) |
| `createCrossAccountZoneDelegationBuilder` | `removalPolicy`   | `DESTROY`             | Matches CDK; `RETAIN` leaves a lame delegation. [Reaches across accounts.](#operational-trade-offs) |
| `createCrossAccountZoneDelegationBuilder` | `providerLogging` | _auto-managed_        | The provider Lambda's log group otherwise never expires and is absent from the template.            |

The defaults are exported as `HOSTED_ZONE_DEFAULTS`, `A_RECORD_DEFAULTS`, `AAAA_RECORD_DEFAULTS`, `CNAME_RECORD_DEFAULTS`, `TXT_RECORD_DEFAULTS`, `MX_RECORD_DEFAULTS`, `SRV_RECORD_DEFAULTS`, `CAA_RECORD_DEFAULTS`, `NS_RECORD_DEFAULTS`, `DS_RECORD_DEFAULTS`, `HTTPS_RECORD_DEFAULTS`, `SVCB_RECORD_DEFAULTS`, and `CROSS_ACCOUNT_ZONE_DELEGATION_DEFAULTS` for visibility and testing.

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

// This composition only synthesises cleanly when `stack` is in `us-east-1`,
// because the default-on query logging on `zone` requires its auto-created
// log group to live there. To run the same shape outside `us-east-1`, pass
// `queryLogging({ logGroupArn })` referencing a us-east-1 log group, or
// `queryLogging(false)` to opt out.
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
