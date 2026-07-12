# @composurecdk/ses

Compose-native SES **receiving-side** builders for [ComposureCDK](../../README.md) — email identities, receipt rule sets, receipt filters, and rule actions.

This first cut covers **inbound** email. Sending-side builders (configuration sets, dedicated IP pools, VDM, reputation alarms) are a later addition.

## Install

```sh
npm install @composurecdk/ses
```

Peer dependencies: `@composurecdk/core`, `@composurecdk/route53` (for `.publishDkim()`), `aws-cdk-lib`, `constructs`.

## Email identity

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
- **`.publishDkim(zone)`** — for the `.domain()` case (e.g. a subdomain whose apex lives elsewhere), publishes the DKIM DNS records into `zone`: three CNAMEs for Easy DKIM, one TXT for BYODKIM. It is mutually exclusive with `.publicHostedZone()` (which already publishes) and not valid for an email identity.
- **`.mailFromDomain(...)`** — a custom MAIL FROM defaults to `REJECT_MESSAGE` on MX failure (no insecure fallback to `amazonses.com`, preserving SPF/DMARC alignment).
- The result exposes `dkim` (the token names/values) for manual publication when a zone isn't available, and `dkimRecords` when `.publishDkim()` was used.

## Receipt rule set

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
- **Actions are free functions** — `s3Action`, `lambdaAction`, `snsAction`, `bounceAction`, `stopAction`, `addHeaderAction` — each accepting `Resolvable`s so a rule wires to sibling components by `ref()`.
- **`s3Action`** injects the SES bucket policy transparently and, when a `kmsKey` is supplied, grants `ses.amazonaws.com` the encrypt permissions the key needs — encryption at rest works out of the box.

### Secure defaults

Every rule gets AWS-recommended defaults, each individually overridable:

| Default       | Value     | Why                                                                                                                                                                                                                                                                            |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scanEnabled` | `true`    | Spam & virus scanning (CloudFormation defaults it off).                                                                                                                                                                                                                        |
| `tlsPolicy`   | `REQUIRE` | Encrypt in transit. ~95%+ of legitimate inbound mail already uses TLS, and a non-TLS sender receives a **hard bounce** (fail-loud, not a silent drop). Override with `.tlsPolicy(TlsPolicy.OPTIONAL)` for a domain that must accept mail from legacy senders without STARTTLS. |

### Activation (on by default)

A receipt rule set is **inert until it is the account's active rule set** — a separate, account-level `ses:SetActiveReceiptRuleSet` call with no CloudFormation resource. Miss it and mail silently vanishes, so `.activate()` is **on by default** (opt out with `.activate(false)`).

Activation is backed by a purpose-built provider (see [ADR-0016](../../docs/adr/0016-domain-action-custom-resource.md)) that **conditionally deactivates**: on delete it clears the active slot only if the currently-active set is this one, so tearing down a stack never disables another stack's rule set. The custom resource is exposed on the result as `activation`.

> Only **one** rule set is active per account/region. If you run multiple rule sets across stacks and need bespoke arbitration, disable activation here and drive `setActiveReceiptRuleSet` yourself with [`@composurecdk/custom-resources`](../custom-resources).

## Receipt filters

```ts
import { createReceiptFilterBuilder, createAllowListReceiptFilterBuilder } from "@composurecdk/ses";
import { ReceiptFilterPolicy } from "aws-cdk-lib/aws-ses";

createReceiptFilterBuilder()
  .ip("10.0.0.0/24")
  .policy(ReceiptFilterPolicy.BLOCK)
  .build(stack, "Blocklist");

createAllowListReceiptFilterBuilder().ips(["203.0.113.0/24"]).build(stack, "Allowlist");
```

## Region support

SES email **receiving** is available only in a subset of Regions. The rule-set and filter builders emit a synth-time warning (`@composurecdk/ses:receiving-region`) when built in a Region that can't receive mail. Identity verification and DKIM work in far more Regions, so the warning is scoped to the receiving constructs.
