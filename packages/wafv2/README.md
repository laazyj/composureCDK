# @composurecdk/wafv2

AWS WAF web ACL builder for [ComposureCDK](../../README.md).

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
      .addRule("BlockAdmin", (rule) =>
        rule
          .statement({
            byteMatchStatement: {
              fieldToMatch: { uriPath: {} },
              positionalConstraint: "STARTS_WITH",
              searchString: "/admin",
              textTransformations: [{ priority: 0, type: "NONE" }],
            },
          })
          .respond(404, { json: { message: "Not found" } }),
      ),
  },
  { api: [], waf: ["api"] },
);
```

The result is `{ webAcl, associations, logGroup?, logging? }`:

| Field          | Type                                   | Description                                                                                              |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `webAcl`       | `CfnWebACL`                            | The web ACL. Its ARN is `webAcl.attrArn`.                                                                |
| `associations` | `CfnWebACLAssociation[]`               | One per `associateWith` call, in that order. Always empty for a CLOUDFRONT web ACL.                      |
| `logGroup`     | `LogGroup \| undefined`                | The `aws-waf-logs-` log group WAF writes to. Absent when logging is off or goes to your own destination. |
| `logging`      | `CfnLoggingConfiguration \| undefined` | The logging configuration. Absent when logging is off.                                                   |

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

| Method                                                          | What it does                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `statement(raw)`                                                | The rule's statement, as CloudFormation's `StatementProperty`. Exactly one per rule. |
| `block()` · `allow()` · `count()` · `captcha()` · `challenge()` | The action. `block()` is the default.                                                |
| `respond(status, body?, headers?)`                              | Block with a custom response — see [Custom responses](#custom-responses).            |
| `labels(...labels)`                                             | Labels to add to matching requests, for later rules to match on.                     |
| `priority(n)`                                                   | Overrides the priority — see [Priorities](#priorities).                              |
| `metricName(name)`                                              | The rule's CloudWatch metric name. Defaults to the rule's name.                      |
| `sampledRequests(enabled)`                                      | Overrides the web ACL's sampling setting for this rule.                              |
| `captchaConfig(…)` · `challengeConfig(…)`                       | Passed through to the rule.                                                          |

Rule names are checked when the rule is added: 1–128 characters of `[A-Za-z0-9_-]`, and unique within the web ACL.

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

### Rule groups

A rule whose statement is a `managedRuleGroupStatement` or a `ruleGroupReferenceStatement` evaluates a group of rules that keep their own actions, so CloudFormation gives it an `overrideAction` instead of an `action`. The builder emits `overrideAction: { None: {} }`, or `{ Count: {} }` when the rule calls `.count()` — the way to try a group out before it blocks anything. Any other action throws.

```ts
createWebAclBuilder().addRule("CommonRuleSet", (rule) =>
  rule
    .statement({
      managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
    })
    .count(),
);
```

### Other checks at synth

- A rate-based rule cannot Allow, and a web ACL can have at most ten of them.
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

- creates a CloudWatch log group through [`@composurecdk/logs`](../logs/README.md), so it gets that package's retention and removal defaults, named `aws-waf-logs-<web ACL name>` (or a name derived from the construct path), since WAF only logs to names with that prefix;
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

WAF writes the log group's resource policy itself when the logging configuration is created, so the deploying principal needs `logs:PutResourcePolicy`, `logs:DescribeResourcePolicies` and `logs:CreateLogDelivery` alongside its WAF permissions. Redaction applies to logs only — see `sampledRequests` in [Defaults](#defaults).

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

Names, metric names and labels are validated at build against the AWS rules above ([ADR-0010](../../docs/adr/0010-aws-property-constraints.md)). The validators are exported for direct use:

```ts
import { constraints } from "@composurecdk/wafv2";

constraints.validate.webAclName("api-waf");
constraints.validate.ruleName("PerIpRate");
constraints.validate.metricName("PerIpRate");
constraints.validate.ruleLabel("auth:missing-token");
```
