# @composurecdk/ses

Compose-native builders for [AWS SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html), part of [ComposureCDK](../../README.md).

SES is Amazon's email service for **sending** and **receiving** mail. This package currently covers the **receiving** path — email identities, receipt rule sets, receipt filters, and rule actions. Sending-side builders (configuration sets, dedicated IP pools, VDM, reputation alarms) will follow.

## Install

```sh
npm install @composurecdk/ses
```

Peer dependencies: `@composurecdk/core`, `@composurecdk/route53` (for `.publishDkim()`), `aws-cdk-lib`, `constructs`.

## Email identity

An [SES email identity](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) is a domain or email address you've verified ownership of, so SES will send or receive mail for it. This builder verifies the identity and sets up [DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim.html) signing.

```ts
import { createEmailIdentityBuilder } from "@composurecdk/ses";
import { ref } from "@composurecdk/core";

const { emailIdentity, dkim } = createEmailIdentityBuilder()
  .domain("ask.example.com") // .email(...) / .publicHostedZone(...) also
  .easyDkim() // default; .byoDkim({ selector, privateKey, publicKey }) for BYODKIM
  .publishDkim(ref<HostedZoneBuilderResult>("zone").get("hostedZone"))
  .build(stack, "MailIdentity");
```

- **`.domain()` / `.email()` / `.publicHostedZone()`** — the three identity variants. `.publicHostedZone(zone)` verifies the zone apex and lets CDK auto-publish DKIM into it — the concise "I own the whole zone" form.
- **`.publishDkim(zone)`** — for the `.domain()` case (e.g. a subdomain whose apex lives elsewhere), publishes the DKIM DNS records into `zone`: three CNAMEs for Easy DKIM, one TXT for BYODKIM. Mutually exclusive with `.publicHostedZone()` (which already publishes); not valid for an email identity.
- **`.mailFromDomain(...)`** — a [custom MAIL FROM domain](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html); defaults to `REJECT_MESSAGE` on MX failure (no insecure fallback to `amazonses.com`, preserving SPF/DMARC alignment).
- The result exposes `dkim` — the identity's DKIM DNS records as `{ name, value }[]` (CDK's `dkimRecords`), for manual publication when a zone isn't available — and `dkimRecords` (the Route 53 records) when `.publishDkim()` was used.

## Receipt rule set

A [receipt rule set](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules.html) is an ordered list of rules that tell SES how to handle inbound mail. Each rule matches recipients and runs an ordered list of actions (store to S3, invoke a Lambda, bounce, …).

```ts
import { createReceiptRuleSetBuilder, s3Action, lambdaAction } from "@composurecdk/ses";
import { ref } from "@composurecdk/core";

const { ruleSet, rules } = createReceiptRuleSetBuilder()
  .rule("inbound", (r) =>
    r
      .recipients(["info@ask.example.com"])
      .addAction(
        "store",
        s3Action(ref<BucketBuilderResult>("mailBucket").get("bucket"), {
          objectKeyPrefix: "inbound/",
        }),
      )
      .addAction("process", lambdaAction(ref<FunctionBuilderResult>("intake").get("function"))),
  )
  .build(stack, "MailRuleSet");
```

- **Rules run in declaration order**, and actions run in the order added — ordering is semantic (a `Stop`/`Bounce` action halts later rules), so it is preserved.
- **`.addAction(key, action)`** takes any CDK [`IReceiptRuleAction`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.IReceiptRuleAction.html). The `s3Action` / `lambdaAction` / `snsAction` / `bounceAction` / `stopAction` / `addHeaderAction` free functions are **optional convenience helpers** — they wrap the CDK `aws-ses-actions` classes and accept `Resolvable`s so a rule can `ref()` sibling components. For an action type we don't yet provide a helper for, construct the CDK action and pass it to `.addAction()` directly.
- **`s3Action`** injects the SES bucket policy transparently and, when given a `kmsKey`, grants `ses.amazonaws.com` the encrypt permissions the key needs — encryption at rest works out of the box.

### Secure defaults

Every rule gets AWS-recommended defaults, each individually overridable:

| Default       | Value     | Why                                                                                                                                                                                                                                                                            |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scanEnabled` | `true`    | Spam & virus scanning (CloudFormation defaults it off).                                                                                                                                                                                                                        |
| `tlsPolicy`   | `REQUIRE` | Encrypt in transit. ~95%+ of legitimate inbound mail already uses TLS, and a non-TLS sender receives a **hard bounce** (fail-loud, not a silent drop). Override with `.tlsPolicy(TlsPolicy.OPTIONAL)` for a domain that must accept mail from legacy senders without STARTTLS. |

> **Migrating from raw `aws-cdk-lib` constructs?** `tlsPolicy` defaults to `REQUIRE` here, whereas CloudFormation defaults to `OPTIONAL` — a deliberately more secure posture, but a behaviour change on migration. Senders without STARTTLS will be bounced; set `.tlsPolicy(TlsPolicy.OPTIONAL)` per rule to retain the raw-construct behaviour.

### Activation (on by default)

A receipt rule set is **inert until it is the account's active rule set** — a separate, account-level `ses:SetActiveReceiptRuleSet` call that [has no CloudFormation resource](https://github.com/aws/aws-cdk/issues/28823) ([SES docs](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-managing-receipt-rule-sets.html)). Miss it and mail silently vanishes, so `.activate()` is **on by default** (opt out with `.activate(false)`).

Activation is backed by a purpose-built provider (see [ADR-0016](../../docs/adr/0016-domain-action-custom-resource.md)) that **conditionally deactivates**: on delete it clears the active slot only if the currently-active set is this one, so tearing down a stack never disables another stack's rule set. The custom resource is exposed on the result as `activation`.

> Only **one** rule set is active per account/region. If you run multiple rule sets across stacks and need bespoke arbitration, disable activation here and drive `setActiveReceiptRuleSet` yourself with [`@composurecdk/custom-resources`](../custom-resources).

## Receipt filters

A [receipt filter](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-managing-ip-filters.html) allows or blocks inbound mail from specific IP addresses or CIDR ranges, before any rule runs.

```ts
import { createReceiptFilterBuilder, createAllowListReceiptFilterBuilder } from "@composurecdk/ses";
import { ReceiptFilterPolicy } from "aws-cdk-lib/aws-ses";

createReceiptFilterBuilder()
  .ip("10.0.0.0/24")
  .policy(ReceiptFilterPolicy.BLOCK)
  .build(stack, "Blocklist");

createAllowListReceiptFilterBuilder().ips(["203.0.113.0/24"]).build(stack, "Allowlist");
```

- **`createReceiptFilterBuilder`** — a single allow/block rule for one IP or CIDR range.
- **`createAllowListReceiptFilterBuilder`** — blocks all senders except the supplied IPs (a block-all filter plus one allow filter per address).

## Region support

SES email **receiving** is available only in a subset of Regions. The rule-set and filter builders emit a synth-time warning (`@composurecdk/ses:receiving-region`) when built in a Region that can't receive mail. Identity verification and DKIM work in far more Regions, so the warning is scoped to the receiving constructs. See the [email receiving endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints) table.
