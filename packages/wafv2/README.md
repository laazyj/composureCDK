# @composurecdk/wafv2

AWS WAF web ACL builder for [ComposureCDK](https://github.com/laazyj/composureCDK/blob/main/README.md).

This package provides a fluent builder for [AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html) web ACLs, their rules and their associations. CDK has no L2 for WAF, so it wraps the [`CfnWebACL`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_wafv2.CfnWebACL.html) and [`CfnWebACLAssociation`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_wafv2.CfnWebACLAssociation.html) L1s directly, and handles the parts of them that only fail at deploy time.

```ts
import { compose, ref } from "@composurecdk/core";
import { createRestApiBuilder, type RestApiBuilderResult } from "@composurecdk/apigateway";
import { createWebAclBuilder } from "@composurecdk/wafv2";

compose(
  {
    api: createRestApiBuilder(),
    waf: createWebAclBuilder()
      .associateWith(ref("api", (r: RestApiBuilderResult) => r.api.deploymentStage))
      .addRule("PerIpRate", (rule) =>
        rule.rateLimit(3000).respond(429, { json: { reason: "throttled" } }),
      )
      .addRule("IpReputation", (rule) =>
        rule.managedRuleGroup("AWSManagedRulesAmazonIpReputationList"),
      ),
  },
  { api: [], waf: ["api"] },
);
```

The result is `{ webAcl, associations, logGroup?, logging?, metrics, alarms }`:

| Field          | Type                                   | Description                                                                                              |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `webAcl`       | `CfnWebACL`                            | The web ACL. Its ARN is `webAcl.attrArn`.                                                                |
| `associations` | `CfnWebACLAssociation[]`               | One per `associateWith` call, in that order. Always empty for a CLOUDFRONT web ACL.                      |
| `logGroup`     | `LogGroup \| undefined`                | The `aws-waf-logs-` log group WAF writes to. Absent when logging is off or goes to your own destination. |
| `logging`      | `CfnLoggingConfiguration \| undefined` | The logging configuration. Absent when logging is off.                                                   |
| `metrics`      | `WebAclMetrics`                        | Metrics for the web ACL, its default action and each rule — see [Metrics](#metrics).                     |
| `alarms`       | `AlarmsOf<WebAclAlarmKey>`             | Recommended and custom alarms, keyed by alarm key — see [Alarms](#alarms).                               |

## Defaults

| Setting             | Default            | Rationale                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`             | `REGIONAL`         | API Gateway, Application Load Balancers, AppSync, Cognito, App Runner and Verified Access are regional. Set `.scope("CLOUDFRONT")` for a distribution — see [CloudFront](#cloudfront).                                                                                                                            |
| default action      | Allow              | A web ACL in front of an application usually lets through what no rule blocks. Use `.defaultAction("block")` for an allow-list.                                                                                                                                                                                   |
| CloudWatch metrics  | on, ACL and rules  | Free, and the only way to see what the rules are doing. Not configurable.                                                                                                                                                                                                                                         |
| metric name         | from name or path  | The web ACL's `name` when set; otherwise a name derived from its construct path, so two web ACLs never share a metric name. Each rule's metric name is its own name.                                                                                                                                              |
| `sampledRequests`   | `false`            | A sampled request keeps every header, including credentials, and [logging redaction does not apply to it](https://docs.aws.amazon.com/waf/latest/developerguide/waf-data-protection-and-logging.html). Turning it on without a `dataProtectionConfig` adds the warning `@composurecdk/wafv2:sampling-unredacted`. |
| logging             | on, non-Allow only | WAF logs go to a created `aws-waf-logs-` log group, keeping the requests it blocks, counts or challenges and redacting `authorization` and `cookie`. See [Logging](#logging).                                                                                                                                     |
| managed rule groups | none               | Every managed group blocks some legitimate traffic until it is tuned. None is added for you.                                                                                                                                                                                                                      |

`WEB_ACL_DEFAULTS` and `WEB_ACL_VISIBILITY_DEFAULTS` export these for inspection. Everything else in `CfnWebACLProps` — `name`, `description`, `dataProtectionConfig`, `captchaConfig`, `challengeConfig`, `tokenDomains`, `associationConfig` and the rest — is set with its own builder method and passed through.

## Rules

`addRule(name, configure)` adds a rule. `configure` receives a rule builder:

| Method                                                          | What it does                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `rateLimit(limit, window?)`                                     | A rate-based statement — see [Rate limits](#rate-limits).                          |
| `blockUnlessHeader(name)`                                       | Matches requests without a header — see [Requiring a header](#requiring-a-header). |
| `managedRuleGroup(name, options?)`                              | Evaluates a managed rule group — see [Managed rule groups](#managed-rule-groups).  |
| `ipSet(arn, forwardedIp?)`                                      | Matches the addresses in an IP set — see [IP sets](#ip-sets).                      |
| `statement(raw)`                                                | The rule's statement, as CloudFormation's `StatementProperty`, for anything else.  |
| `block()` · `allow()` · `count()` · `captcha()` · `challenge()` | The action. `block()` is the default.                                              |
| `respond(status, body?, headers?)`                              | Block with a custom response — see [Custom responses](#custom-responses).          |
| `labels(...labels)`                                             | Labels to add to matching requests, for later rules to match on.                   |
| `priority(n)`                                                   | Overrides the priority — see [Priorities](#priorities).                            |
| `metricName(name)`                                              | The rule's CloudWatch metric name. Defaults to the rule's name.                    |
| `sampledRequests(enabled)`                                      | Overrides the web ACL's sampling setting for this rule.                            |
| `captchaConfig(…)` · `challengeConfig(…)`                       | Passed through to the rule.                                                        |

Each rule has exactly one statement, from one of the first five methods; a second throws. Rule names are checked when the rule is added: 1–128 characters of `[A-Za-z0-9_-]`, and unique within the web ACL.

### Rate limits

`rateLimit(limit, window?)` matches each client's requests once it has sent more than `limit` of them in `window`, and keeps matching until its rate falls back under the limit, both with a lag (see below). The window is 1, 2, 5 (the default) or 10 minutes; the limit 10 to 2,000,000,000. A client is an IP address unless you say otherwise:

| Method                                     | Counts requests per                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `aggregateOnIp()`                          | client IP address. The default.                                                           |
| `aggregateOnForwardedIp(header, fallback)` | IP address in a header such as `X-Forwarded-For`, for a web ACL behind a proxy.           |
| `aggregateOnHeader(name)`                  | value of a header, as sent.                                                               |
| `aggregateOn(...keys)`                     | anything else CloudFormation's `RateBasedStatementCustomKey` takes: a cookie, the path, … |
| `scopeDown(statement)`                     | — counts only the requests that match `statement`, such as a login path.                  |

The aggregate methods add up: `.aggregateOnIp().aggregateOnHeader("x-api-key")` limits each key from each address. One key of IP or forwarded IP is emitted as WAF's `IP` or `FORWARDED_IP` aggregate key type, since WAF takes those among custom keys only alongside another; anything else is `CUSTOM_KEYS`. At most five keys, and none twice, are checked at synth.

**A limit takes effect with a lag, both ways.** In a sandbox test, a limit of 10 a minute began answering `429` about 25 seconds into a burst of 2 requests a second, and lifted about a minute after the burst stopped. So when testing a rule, don't take a limit that hasn't fired yet for a broken one, and give a limit that has to hold tightly some margin.

**A request missing a key is not counted or limited at all.** WAF [omits requests missing any aggregation component](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-request-limiting.html), so a limit on a header needs a rule before it that blocks requests without the header, or a client sidesteps the limit by leaving it out. For an API called with temporary AWS credentials, that is a limit per STS session:

```ts
createWebAclBuilder()
  .addRule("RequireSessionToken", (rule) => rule.blockUnlessHeader("x-amz-security-token"))
  .addRule("PerCredentialRate", (rule) =>
    rule
      .rateLimit(60, Duration.minutes(1))
      .aggregateOnHeader("x-amz-security-token")
      .respond(429, { json: { reason: "throttled" } }),
  )
  .addRule("PerIpRate", (rule) =>
    rule.rateLimit(3000).respond(429, { json: { reason: "throttled" } }),
  );
```

The per-IP limit is a backstop, set well above the per-credential one because many clients may share a NAT address. Answering `429` rather than WAF's `403` lets a client tell throttling from an IAM denial.

### Requiring a header

`blockUnlessHeader(name)` matches requests that lack the header or send it empty, and blocks them unless you choose another action. WAF treats a request without the header as [not matching a statement that inspects it](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-fields-list.html), so the builder emits a `NotStatement` around a size check, which matches exactly those requests. The header name is not case-sensitive. It checks presence only: whether the value is valid is for the application to decide.

### IP sets

`ipSet(arn, forwardedIp?)` matches requests from the addresses in an `AWS::WAFv2::IPSet`, given by ARN or as a `ref`. It blocks by default; `.allow()` makes it an allow-list. Pass `{ headerName, fallbackBehavior, position }` to match the address in a header such as `X-Forwarded-For` instead.

```ts
.addRule("Office", (rule) => rule.ipSet(ref("ips", (r: CfnIPSet) => r.attrArn)).allow())
```

### Raw statements and CloudFormation casing

`statement()` takes CDK's `CfnWebACL.StatementProperty`. Most of it is camelCase, as usual, but CDK types several fields as `any` and passes them through untouched, so **they need CloudFormation's PascalCase**. A wrong case is accepted at synth and fails at deploy.

```ts
rule.statement({
  sizeConstraintStatement: {
    fieldToMatch: { singleHeader: { Name: "x-api-key" } }, // Name, not name
    comparisonOperator: "GT",
    size: 0,
    textTransformations: [{ priority: 0, type: "NONE" }],
  },
});
```

The `any`-typed fields are `FieldToMatch`'s `singleHeader`, `singleQueryArgument`, `allQueryArguments`, `queryString`, `uriPath` and `method`, and a rate-based statement's custom keys `ip`, `forwardedIp`, `httpMethod` and `asn`. Fields that are empty objects (`uriPath: {}`) are unaffected.

### Priorities

WAF evaluates rules from the lowest priority up. Each rule's priority defaults to ten times its position in `addRule` order — 0, 10, 20, … — so rules run in the order they are declared, and there is room to insert one with an explicit `.priority(n)` without renumbering the rest. Two rules with the same priority throw at build, naming both. Changing a priority updates the web ACL in place.

### Managed rule groups

`managedRuleGroup(name, options?)` evaluates a group of rules that AWS or a Marketplace vendor maintains. A rule-group rule keeps its rules' own actions, so CloudFormation gives it an `overrideAction` instead of an `action`. The builder emits `overrideAction: { None: {} }`, or `{ Count: {} }` when the rule calls `.count()`; any other action throws.

```ts
createWebAclBuilder().addRule("CommonRuleSet", (rule) =>
  rule.managedRuleGroup("AWSManagedRulesCommonRuleSet", {
    version: "Version_1.12",
    overrides: { SizeRestrictions_BODY: "count" },
  }),
);
```

| Option                    | Effect                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendorName`              | Defaults to `AWS`.                                                                                                                                                                                                                                                                                    |
| `version`                 | Pins a static version, and adds a `DaysToExpiry` alarm — see [Alarms](#alarms). The IP reputation groups have no versions, so pinning one throws.                                                                                                                                                     |
| `overrides`               | Rule action overrides, by rule name. [WAF silently ignores](https://docs.aws.amazon.com/waf/latest/APIReference/API_RuleActionOverride.html) a name that matches no rule, case-sensitively, so a name this package does not know for an AWS group warns (`@composurecdk/wafv2:unknown-managed-rule`). |
| `managedRuleGroupConfigs` | Configuration a group needs, such as Bot Control's inspection level. Passed through.                                                                                                                                                                                                                  |

`scopeDown(statement)` limits the group to matching requests. `AWS_MANAGED_RULE_GROUP_RULES` lists the AWS groups that carry no subscription fee and the names of their rules, which the editor offers for `overrides`. A `ruleGroupReferenceStatement` for your own rule group goes through `statement()`, and gets the same `overrideAction` handling.

**No managed group is added by default.** Each blocks some legitimate traffic until it is tuned: CommonRuleSet's `SizeRestrictions_BODY` blocks bodies over 8 KB and `NoUserAgent_HEADER` blocks clients that send no `User-Agent`, which some SDKs and webhooks do not; AnonymousIpList blocks hosting providers' addresses. A default that blocked would break applications, and one that only counted would cost capacity while implying a protection that isn't there.

A reasonable baseline for most applications is CommonRuleSet, KnownBadInputs and AmazonIpReputationList, 925 WCU between them. AWS [recommends rolling a group out in count mode first](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html): add it with `.count()`, watch its `CountedRequests` and the logs for the rules that match legitimate traffic, override those, then drop `.count()`.

```ts
createWebAclBuilder()
  .addRule("IpReputation", (rule) =>
    rule.managedRuleGroup("AWSManagedRulesAmazonIpReputationList").count(),
  )
  .addRule("CommonRuleSet", (rule) => rule.managedRuleGroup("AWSManagedRulesCommonRuleSet").count())
  .addRule("KnownBadInputs", (rule) =>
    rule.managedRuleGroup("AWSManagedRulesKnownBadInputsRuleSet").count(),
  );
```

### Other checks at synth

- A rate-based rule cannot Allow, and a web ACL can have at most ten of them.
- The `aggregateOn*` methods apply to `rateLimit()` rules only, and `scopeDown()` to `rateLimit()` and `managedRuleGroup()` rules.
- Labels are 1–128 characters of `[A-Za-z0-9_-]` per colon-separated part, with at most five namespaces, and none of WAF's reserved words (`awswaf`, `aws`, `waf`, `rulegroup`, `webacl`, `regexpatternset`, `ipset`, `managed`). WAF adds the `awswaf:<account>:webacl:<name>:` prefix itself.
- Metric names follow the rule for names, and `All` and `Default_Action` are reserved.

The builder does not compute [web ACL capacity units](https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html): only WAF's `CheckCapacity` is authoritative. A web ACL over 1,500 WCU is billed extra, and 5,000 is the hard limit.

## Custom responses

`respond(status, body?, headers?)` blocks with your own status code, body and headers rather than WAF's `403`. CloudFormation wants the body declared once on the web ACL and referenced by key from the rule; the builder does that for you, keying each body by the first rule that uses it and sharing one key between identical bodies.

```ts
rule.respond(429, { json: { reason: "throttled" } }, { "Retry-After": "60" });
```

The body is `{ json }` (serialised unless it is already a string), `{ text }` or `{ html }`, which set the content type. The default action can respond too: `.defaultAction("block", { status: 403, body: { text: "Forbidden" } })`.

These are checked at synth, against the [supported status codes](https://docs.aws.amazon.com/waf/latest/developerguide/customizing-the-response-status-codes.html) and [quotas](https://docs.aws.amazon.com/waf/latest/developerguide/limits.html):

- **Status:** one of 200, 201, 202, 204, 206, 300, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409, 411, 412, 413, 414, 415, 416, 421, 429, 500, 501, 502, 503, 504 or 505. Notably not 410, and 402 is reserved for Monetize. Exported as `SUPPORTED_CUSTOM_RESPONSE_STATUS_CODES`.
- **Body:** at most 4 KB each, 50 distinct bodies and 50 KB in total per web ACL.
- **Headers:** at most 10, names of 1–64 characters of `[a-zA-Z0-9._$-]`, no duplicates, and not `content-type`, which WAF sets from the body.

A custom response only applies to Block, so `respond()` after another action, or another action after `respond()`, throws.

## Logging

Logging is on by default, because the [Well-Architected security pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html) asks for it and cdk-nag's NIST 800-53, PCI DSS and HIPAA packs fail a web ACL without it (`WAFv2LoggingEnabled`). The builder:

- creates a CloudWatch log group through [`@composurecdk/logs`](https://github.com/laazyj/composureCDK/blob/main/packages/logs/README.md), so it gets that package's retention and removal defaults, named `aws-waf-logs-<web ACL name>` (or a name derived from the construct path), since WAF only logs to names with that prefix;
- points an `AWS::WAFv2::LoggingConfiguration` at it, using the log group ARN **without** the trailing `:*` that `logGroup.logGroupArn` has, which WAF rejects;
- keeps only the requests WAF blocks, counts, or answers with a CAPTCHA or challenge (`DEFAULT_LOGGING_FILTER`). Filtering is AWS's main lever on log [volume and cost](https://docs.aws.amazon.com/waf/latest/developerguide/logging-management.html);
- redacts the `authorization` and `cookie` headers (`DEFAULT_LOGGING_REDACTED_HEADERS`), which carry replayable credentials and are no help when tuning a rule.

```ts
createWebAclBuilder().logging({
  filter: "all",
  redact: { headers: ["x-amz-security-token"], queryString: true },
  configure: (logGroup) => logGroup.retention(RetentionDays.ONE_YEAR),
});
```

| Option        | Effect                                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter`      | `"non-allow"` (default), `"all"`, or a typed `{ defaultBehavior, filters }` whose conditions are `{ action }` or `{ label }`. The builder emits CloudFormation's PascalCase JSON, which CDK types as `any`.                                                                      |
| `redact`      | `headers`, `queryString`, `uriPath`, `method`. **`headers` adds to `authorization` and `cookie`; it does not replace them.** At most 100 fields.                                                                                                                                 |
| `configure`   | Customizes the created log group's builder. A name that does not start with `aws-waf-logs-` throws, since the deploy would fail.                                                                                                                                                 |
| `destination` | Logs to an existing CloudWatch log group, S3 bucket or Firehose stream instead, by ARN or `ref`. Its name must start with `aws-waf-logs-`; an S3 bucket must use SSE-S3 or a customer managed key, and a Firehose stream must be DirectPut. Cannot be combined with `configure`. |

`.logging(false)` turns logging off.

WAF grants `delivery.logs.amazonaws.com` write access to the log group itself when the logging configuration is created. It does this with a policy on the log group, not an account-level one, so it does not count toward CloudWatch Logs' limit of 10 resource policies per Region. The identity that creates the configuration (CloudFormation's execution role, under a CDK bootstrap) needs `logs:PutResourcePolicy`, `logs:DescribeResourcePolicies` and `logs:CreateLogDelivery` alongside its WAF permissions. Without them, the logging configuration fails to create and the deploy rolls back; logging is never left silently off. To see the policy, run `aws logs describe-resource-policies --policy-scope RESOURCE --resource-arn <log group ARN>`. A plain `describe-resource-policies` lists only account-level policies. Redaction applies to logs only — see `sampledRequests` in [Defaults](#defaults).

## Metrics

`result.metrics` builds the [`AWS/WAFV2` metrics](https://docs.aws.amazon.com/waf/latest/developerguide/waf-metrics.html) from the names the builder gave the web ACL and its rules, so there is nothing to thread through by hand:

```ts
const { metrics } = createWebAclBuilder().addRule("PerIpRate", …).build(stack, "Waf");

metrics.blockedRequests(); // every rule: Rule=ALL
metrics.rule("PerIpRate").blockedRequests(); // one rule, by the name given to addRule
metrics.defaultAction.allowedRequests(); // requests no rule terminated
metrics.daysToExpiry({ vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet", version: "Version_1.12" });
```

Each request metric — `allowedRequests`, `blockedRequests`, `countedRequests`, `captchaRequests`, `challengeRequests` — is a Sum over 5 minutes unless you pass `MetricOptions`.

The dimensions follow what WAF actually publishes, which differs from its documentation in two places (checked against a deployed web ACL):

- **`WebACL` is the web ACL's _name_**, not its `VisibilityConfig` metric name. An unnamed web ACL's dimension reads the generated name from its `Ref`.
- **The default action is published as `Rule=<the web ACL's metric name>`**, not `Rule=Default_Action`.
- `Rule` is the rule's metric name, and `Region` is present for a regional web ACL only.

## Alarms

The recommended alarms are per rule. AWS publishes [no recommended alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html) for WAF, so the defaults below (`WEB_ACL_RULE_ALARM_DEFAULTS`) are this library's starting points. Every alarm treats missing data as not breaching, because WAF publishes a datapoint only when its count is non-zero. No alarm actions are configured — apply them from the result or with [`alarmActionsPolicy`](https://github.com/laazyj/composureCDK/blob/main/packages/cloudwatch/README.md).

| Alarm key               | Created for                                | Metric                         | Default threshold | Why                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------ | ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<rule>BlockedRequests` | a rule you wrote whose action is Block     | `BlockedRequests` (Sum, 5 min) | > 0               | A block by your own rule is a signal: a throttled client, a request without its credentials. Raise it on a rule that blocks routinely.                                                                       |
| `<rule>BlockedRequests` | a rule-group rule — **opt-in**             | `BlockedRequests` (Sum, 5 min) | > 0               | Managed rules block internet background noise all day; on by default, it would page constantly.                                                                                                              |
| `<rule>DaysToExpiry`    | a managed rule group pinned to a `version` | `DaysToExpiry` (Min, 1 hour)   | < 30              | [Once a pinned version expires](https://docs.aws.amazon.com/waf/latest/developerguide/waf-managed-rule-groups-versioning-expiration.html), WAF rejects every update to the web ACL that does not move it on. |

`<rule>` is the rule's name in camelCase: `PerIpRate` and `per-ip-rate` both become `perIpRate`, so two rules whose names differ only that way cannot both have alarms; the build throws, naming them. No alarm is created for a rule that counts, allows, or answers with a CAPTCHA or challenge.

Tune or disable a rule's alarms with `.alarms()`, all of them with `.recommendedAlarms(false)`, and add your own with `addAlarm`, whose metric factory receives `WebAclMetrics`:

```ts
createWebAclBuilder()
  .addRule("PerIpRate", (rule) => rule.statement(…).alarms({ blockedRequests: { threshold: 50 } }))
  .addRule("CommonRuleSet", (rule) => rule.statement(…).alarms({ blockedRequests: { threshold: 1000 } }))
  .addRule("Probe", (rule) => rule.statement(…).count().alarms(false))
  .addAlarm("probeCounted", (alarm) =>
    alarm.metric((m) => m.rule("Probe").countedRequests()).threshold(100),
  );
```

A CLOUDFRONT web ACL's metrics are published in `us-east-1`, where the web ACL must be, so its alarms need nothing special.

### Reading alarms by key

`WebAclBuilderResult` types `alarms` by key, so a misspelled key is a compile error rather than `undefined` at synth. The recommended keys are typed by suffix, so any `<rule>BlockedRequests` or `<rule>DaysToExpiry` is accepted and `<rule>BlockedRequest` is not. A recommended alarm is `Alarm | undefined`, because it can be disabled or not apply to the rule. To read a custom alarm, name its key with `WithCustomAlarms`, from `@composurecdk/cloudwatch`, and it is typed `Alarm`:

```ts
ref("waf", (r: WebAclBuilderResult) => r.alarms.perIpRateBlockedRequests); // Alarm | undefined
ref("waf", (r: WithCustomAlarms<WebAclBuilderResult, "probeCounted">) => r.alarms.probeCounted); // Alarm
ref("waf", (r: WebAclBuilderResult) => r.alarms.probeCounted); // compile error
```

The custom keys you name are not checked against the builder's `addAlarm` calls. The result of the builder's own `build()` accepts any key, as `WithCustomAlarms<WebAclBuilderResult, string>`. The recommended keys are exported as `WebAclAlarmKey`.

## Associations

`associateWith(target)` protects a regional resource. Call it once per resource; one web ACL can protect many. The target is an ARN, a CDK reference that `CfnWebACLAssociation` accepts in your `aws-cdk-lib` (recent releases take an Application Load Balancer or AppSync API), or an API Gateway stage, as a value or a `ref`.

- The association references the web ACL by `webAcl.attrArn`, so tools that check for one by reference, such as cdk-nag's `AwsSolutions-APIG3`, find it.
- A stage's ARN references the stage, so the association waits for it. A construct target is also depended on explicitly.
- AWS accepts one `AssociateWebACL` call every two seconds, so each association depends on the one before it rather than racing it.
- Each association's construct id is derived from its target, not its position, so removing one target does not replace — and briefly disassociate — the others.

## CloudFront

A web ACL for a CloudFront distribution has `.scope("CLOUDFRONT")` and must be created in `us-east-1`. The builder throws at synth when its stack is in another region, falls back to `CDK_DEFAULT_REGION` for an environment-agnostic stack, and warns (`@composurecdk/wafv2:cloudfront-region`) when it cannot tell. A distribution attaches the web ACL itself, through its `webAclId`, so `associateWith` throws:

```ts
const { webAcl } = createWebAclBuilder().scope("CLOUDFRONT").build(usEast1Stack, "EdgeWaf");
// distribution.webAclId(webAcl.attrArn)
```

## Constraints

Names, metric names, labels and the web ACL's description are validated at build against the AWS rules ([ADR-0010](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0010-aws-property-constraints.md)), so a description [CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html) would reject, such as one with an apostrophe or underscore, fails at synth rather than at deploy. The validators are exported for direct use:

```ts
import { constraints } from "@composurecdk/wafv2";

constraints.validate.webAclName("api-waf");
constraints.validate.webAclDescription("Protects the API");
constraints.validate.ruleName("PerIpRate");
constraints.validate.metricName("PerIpRate");
constraints.validate.ruleLabel("auth:missing-token");
```
