# @composurecdk/ses

Compose-native builders for [AWS SES](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html), part of [ComposureCDK](../../README.md).

SES is Amazon's email service for **sending** and **receiving** mail. This package covers both: the **sending** path — configuration sets, event routing, send grants, and account reputation alarms — and the **receiving** path — email identities, receipt rule sets, receipt filters, and rule actions. (Dedicated IP pools, account-level VDM, and SES templates will follow.)

## Install

```sh
npm install @composurecdk/ses
```

Peer dependencies: `@composurecdk/core`, `@composurecdk/cloudformation`, `@composurecdk/cloudwatch` (for reputation alarms), `@composurecdk/route53` (for `.publishDkim()`), `aws-cdk-lib`, `constructs`.

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

## Sending

The sending path centres on a **configuration set** (the unit that tracks and
controls a stream of outbound mail), a **send grant** to whatever role sends, and
an account-level **reputation safety net**.

```ts
import {
  createConfigurationSetBuilder,
  createEmailIdentityBuilder,
  createReputationAlarmBuilder,
  identityGrants,
  snsDestination,
} from "@composurecdk/ses";
import { EmailSendingEvent } from "aws-cdk-lib/aws-ses";
import { compose, ref } from "@composurecdk/core";

compose(
  {
    feedback: createTopicBuilder(),

    // TLS required + reputation metrics on by default; route bounces/complaints out.
    mailConfig: createConfigurationSetBuilder().addEventDestination("feedback", {
      destination: snsDestination(ref<TopicBuilderResult>("feedback").get("topic")),
      events: [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT, EmailSendingEvent.REJECT],
    }),

    // Associate the identity with the config set so every send is tracked.
    identity: createEmailIdentityBuilder()
      .domain("mail.example.com")
      .configurationSet(ref<ConfigurationSetBuilderResult>("mailConfig").get("configurationSet")),

    // Least-privilege ses:SendEmail on the identity, scoped to one From address.
    sender: createFunctionBuilder().grant(
      identityGrants.sendFrom(ref<EmailIdentityBuilderResult>("identity").get("emailIdentity"), [
        "alerts@mail.example.com",
      ]),
    ),

    // Account-level bounce/complaint alarms (create once per account/Region).
    reputation: createReputationAlarmBuilder(),
  },
  {
    feedback: [],
    mailConfig: ["feedback"],
    identity: ["mailConfig"],
    sender: ["identity"],
    reputation: [],
  },
);
```

### Configuration set

A [configuration set](https://docs.aws.amazon.com/ses/latest/dg/using-configuration-sets.html)
applies to every message sent with it — enforcing TLS, publishing reputation
metrics, and routing send events.

- **`.addEventDestination(key, { destination, events?, enabled? })`** — routes send
  events to a destination. The `snsDestination` / `eventBusDestination` /
  `cloudWatchDestination` helpers accept `Resolvable`s so a destination can `ref()`
  a sibling topic or bus. Routing `BOUNCE`/`COMPLAINT` to a suppression workflow is
  how a production sender protects its reputation — AWS **requires** you to track
  them. (EventBridge destinations can only target the account's **default** bus.)
- Every other [`ConfigurationSetProps`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ses.ConfigurationSetProps.html)
  field passes through — `dedicatedIpPool`, `suppressionReasons`, `vdmOptions`,
  `sendingEnabled`, etc.

#### Secure defaults

| Default             | Value     | Why                                                                                                           |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `tlsPolicy`         | `REQUIRE` | Encrypt in transit. Override with `.tlsPolicy(ConfigurationSetTlsPolicy.OPTIONAL)` for receivers without TLS. |
| `reputationMetrics` | `true`    | Publish per-config-set bounce/complaint metrics (CloudFormation defaults this off).                           |

> **Migrating from raw `aws-cdk-lib`?** `tlsPolicy` defaults to `REQUIRE` here vs.
> CloudFormation's `OPTIONAL` — a more secure posture, but a behaviour change on
> migration.

### Send grants

Sending is authorised on the **identity** resource (a configuration set has no ARN),
so grants live on `identityGrants` and are declared on the **consumer** (the role or
function that sends), per [ADR-0013](../../docs/adr/0013-consumer-side-grants.md).

- **`identityGrants.send(identity)`** — `ses:SendEmail` + `ses:SendRawEmail` on the
  identity ARN (delegates to CDK's native `grantSendEmail`).
- **`identityGrants.sendFrom(identity, fromAddresses)`** — the same, scoped with a
  `ses:FromAddress` condition (StringLike, so `alerts+*@example.com` works) — the
  least-privilege posture so a leaked credential can't send as arbitrary addresses.

### Reputation alarms

`createReputationAlarmBuilder()` creates the AWS-recommended account-level alarms:

| Alarm           | Metric (`AWS/SES`)         | Default threshold | SES action at threshold            |
| --------------- | -------------------------- | ----------------- | ---------------------------------- |
| `bounceRate`    | `Reputation.BounceRate`    | `>= 0.05` (5%)    | Account under review (pause ≥10%)  |
| `complaintRate` | `Reputation.ComplaintRate` | `>= 0.001` (0.1%) | Account under review (pause ≥0.5%) |

Both use `Average` over a 1-hour period with `treatMissingData: IGNORE`, per the
[SES reputation-alarm guidance](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html).
These metrics are **account/Region-scoped and dimensionless**, so build this once per
account/Region — not per configuration set. Tune or disable via `recommendedAlarms`,
add custom alarms with `.addAlarm()`, and apply alarm actions from the result (no
actions are configured by default). `.recommendedAlarms(false)` disables the
**recommended** alarms only — custom alarms added via `.addAlarm()` are an explicit
opt-in and are always created.

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
