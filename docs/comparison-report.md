# ComposureCDK vs. idiomatic CDK — static-website comparison

> **Status:** draft research report for maintainers. Not yet part of the published docs.
> Purpose: evaluate how the ComposureCDK static-website showcase reads against the
> canonical AWS / community CDK examples, and decide what (if anything) to lift into
> public documentation.

## 1. Why this comparison

The [showcase](showcase.md) and the [`ComposureCDK-StaticWebsiteStack`](../packages/examples/src/static-website/app.ts)
example both center on the same well-trodden architecture: **a static site on S3, fronted
by CloudFront, with TLS, DNS, content deployment, alarms, health checks and a budget guard.**
This is the single most common "hello world plus production hardening" shape in the CDK
ecosystem, which makes it the fairest place to put ComposureCDK's conciseness/readability
claims next to what an engineer would otherwise copy from AWS.

The comparison targets three reference points, chosen to span the realistic spectrum of
"what would I reach for instead":

| #   | Reference                                                                                                                                                                                                                                                                                                                                                                                                | What it represents                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A   | [`aws-samples/aws-cdk-examples` → `typescript/static-site`](https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/static-site/static-site.ts)                                                                                                                                                                                                                                             | The **canonical, hand-written L2** example AWS itself ships and most blogs clone.        |
| B   | [`@aws-solutions-constructs/aws-cloudfront-s3` (`CloudFrontToS3`)](https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html)                                                                                                                                                                                                                                                       | The **opinionated L3 pattern** — maximum concision, fixed scope.                         |
| C   | Community / AWS-blog hand-rolled stacks (e.g. the [APN "secure & scalable" CDK post](https://aws.amazon.com/blogs/apn/automating-secure-and-scalable-website-deployment-on-aws-with-amazon-cloudfront-and-aws-cdk/), [pepperize `cdk-route53-health-check`](https://github.com/pepperize/cdk-route53-health-check), [`cdk-monitoring-constructs`](https://github.com/cdklabs/cdk-monitoring-constructs)) | What people actually assemble when they need **monitoring + health checks** on top of A. |

The headline finding up front: **no canonical example covers the same feature set as the
ComposureCDK showcase in one place.** A and B stop well short of alarms, health checks and
cost guards; reaching parity means hand-assembling C's pieces. So the comparison is partly
"same job, fewer lines" (A, B) and partly "a job no single reference example actually does" (C).

## 2. The ComposureCDK baseline

Two artefacts make up the showcase:

- **The runnable example** — [`static-website/app.ts`](../packages/examples/src/static-website/app.ts),
  ~110 lines including generous doc comments and _two_ inline CloudFront functions. Synth-verified
  (see [`static-website-app.test.ts`](../packages/examples/test/static-website-app.test.ts)) to produce:
  3 buckets (content + S3 access-log + CloudFront access-log), all private/encrypted/SSL-enforced;
  OAC; security-headers response policy; HTTP/2+3; PriceClass_100; HTTP→HTTPS; custom 403/404 error
  pages; a multi-behavior distribution (`/api/*` → HTTP origin); and **recommended CloudWatch alarms**
  for CloudFront (5xx error rate, origin latency), S3 (4xx/5xx) and each CloudFront function
  (execution errors / validation errors / throttles), all routed to an SNS topic via one
  `alarmActionsPolicy(...)` call.
- **The case studies** ([jasonduffett.net](https://github.com/laazyj/jasonduffett.net), ukehoot.net,
  uke-o-ono.com) — the _full_ production shape: Route 53 zone, `us-east-1` ACM cert with `www` SAN,
  health-check alarms, a hard monthly **AWS Budgets** guard, GitHub-OIDC deploy role, multi-stack split.

The defining property of both: **the well-architected baseline is the default, not the code.**
Versioned/RETAIN buckets, server access logging, DNS query logging, OAC, SSL enforcement, scoped
IAM and the recommended alarm set come from builder defaults ([architecture.md](architecture.md#defaults)),
so the source reads as _only the site-specific decisions_ — redirects, the cross-region cert,
alarm thresholds — rather than restating boilerplate.

## 3. Reference A — `aws-cdk-examples/static-site`

The canonical example, in full, is a single ~90-line `Construct`:

```typescript
const zone = route53.HostedZone.fromLookup(this, "Zone", { domainName: props.domainName });
const siteDomain = props.siteSubDomain + "." + props.domainName;

const siteBucket = new s3.Bucket(this, "SiteBucket", {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

const certificate = new acm.Certificate(this, "SiteCertificate", {
  domainName: siteDomain,
  validation: acm.CertificateValidation.fromDns(zone),
});

const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
  certificate,
  defaultRootObject: "index.html",
  domainNames: [siteDomain],
  minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 403,
      responsePagePath: "/error.html",
      ttl: Duration.minutes(30),
    },
  ],
  defaultBehavior: {
    origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
    compress: true,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
});

new route53.ARecord(this, "SiteAliasRecord", {
  recordName: siteDomain,
  target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
  zone,
});

new s3deploy.BucketDeployment(this, "DeployWithInvalidation", {
  sources: [s3deploy.Source.asset(path.join(__dirname, "./site-contents"))],
  destinationBucket: siteBucket,
  distribution,
  distributionPaths: ["/*"],
});
```

**Functionality vs. showcase.** Covers S3 + OAC + CloudFront + DNS-validated ACM + Route 53 alias +
content deploy with invalidation. **Absent:** any CloudWatch alarm, SNS topic, Route 53 health check,
budget guard, CloudFront/S3 access logging, security-headers policy, `www` SAN, second behavior, and
CloudFront functions. It also makes two choices a production site usually reverses: a `DESTROY` +
`autoDeleteObjects` content bucket (ComposureCDK defaults to versioned/RETAIN), and an unlogged
distribution.

**Code coherence.** Good, within its scope. It's a flat procedural sequence; the dependency order
(bucket → cert → distribution → record → deploy) is implicit in line order — exactly the "dependencies
as execution order, not data" pattern [architecture.md](architecture.md#design-drivers) calls out.
Wiring is by local variable (`siteBucket`, `distribution` threaded by hand). Fine at this size; it's
the thing that doesn't scale as the alarm/health-check/budget surface grows.

**Conciseness.** Genuinely compact **for what it does** — but it does perhaps 40% of the showcase's job.
Normalising for functionality, ComposureCDK is far ahead: reaching this example's _exact_ output in
ComposureCDK is the `bucket` + `cdn` + `deploy` components (≈20 lines), and the defaults it omits
(logging, SSL enforcement, security headers, RETAIN) come for free rather than as extra lines.

**Readability.** Very approachable for a newcomer — plain constructs, no framework concepts. The cost
is that _intent_ and _boilerplate_ sit at the same altitude: `minimumProtocolVersion`, `allowedMethods`,
`compress` are restated every time, and nothing signals which values are deliberate vs. inherited.
ComposureCDK inverts this — defaults are invisible, deviations are loud.

## 4. Reference B — `CloudFrontToS3` (AWS Solutions Constructs)

The opposite extreme. The minimal deployment is:

```typescript
import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";

new CloudFrontToS3(this, "static-site", {});
```

Out of the box it provisions a private content bucket, an S3 access-log bucket, a CloudFront
distribution with OAC, a CloudFront access-log bucket, HTTP→HTTPS, and (by default) injected HTTP
security headers.

**Functionality vs. showcase.** Strong on the S3/CloudFront/logging/OAC/security-headers core —
that part overlaps the showcase's _defaults_ closely, which is a useful external corroboration that
ComposureCDK's baked-in baseline matches AWS's own opinion. **Absent and not its job:** ACM, custom
domain/DNS, alarms, SNS, health checks, budgets, content deployment, CloudFront functions.

**Code coherence.** Highest of all references — one construct, one identity, nothing to wire. But it's
coherent because it's _closed_: customisation happens through a wide `...Props` override surface, and
once you need a custom-domain cert, a second origin, or your own alarm thresholds you're back to passing
raw L2 props into the construct — the readability gain erodes exactly where the showcase adds value.

**Conciseness.** Unbeatable at three lines, but it's three lines for a strictly smaller scope. It's the
right comparison for "do I even need a builder library for a trivial private bucket + CDN?" and an honest
report should concede B wins that narrow case. It is _not_ a comparison for the production shape.

**Readability.** Maximal at first glance, lower under modification — the meaning of a `CloudFrontToS3`
depends on knowing its (large) default set, and overrides are positional props rather than a fluent,
self-documenting chain.

## 5. Reference C — the "add monitoring yourself" reality

There is **no single canonical example** that matches the showcase's full feature set (verified by
search across aws-samples, awslabs, Constructs Hub and the AWS blogs). To get there from A you bolt on:

- an **SNS topic** + subscription;
- **CloudWatch alarms** — CloudFront `5xxErrorRate` and `OriginLatency`, S3 `4xx/5xxErrors` (needs the
  request-metrics filter enabled), and per-function error/throttle alarms — each with `alarmActions`;
- a **Route 53 health check** + its companion alarm (commonly via [`pepperize/cdk-route53-health-check`](https://github.com/pepperize/cdk-route53-health-check)
  or [`cdk-monitoring-constructs`](https://github.com/cdklabs/cdk-monitoring-constructs));
- an **AWS Budgets** monthly guard.

In idiomatic CDK each alarm is ~6–10 lines (metric → alarm → `addAlarmAction`), repeated per metric,
so parity with the showcase is realistically **+120–180 lines** of mechanical, easy-to-get-subtly-wrong
code (right metric namespace, statistic, period, missing-data handling) on top of A's ~90.

**Functionality.** This is the only reference that _can_ reach parity — by composition of third-party
libraries the team must select, version and wire themselves.

**Code coherence.** This is where hand-rolled CDK is weakest and the showcase strongest. Alarms live far
from the resource they watch; the SNS action is repeated on every alarm; thresholds are scattered. The
showcase collapses all of that into `.recommendedAlarms({ errorRate: { threshold: 2 } })` on the resource
itself, plus **one** `alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(alerts.topic)] } })`
that routes _every_ alarm in the stack — a genuinely different coherence story, not just fewer characters.

**Conciseness / readability.** No contest at parity scope: a fluent `.recommendedAlarms(...)` that encodes
the AWS-recommended metric set reads as intent; a hand-built `new Alarm(this, 'Cf5xx', { metric: distribution.metric5xxErrorRate(...), threshold, evaluationPeriods, ... })` repeated six times reads as plumbing.

## 6. Feature matrix

| Capability                                 | A · aws-cdk-examples | B · CloudFrontToS3 | C · hand-rolled + libs | **ComposureCDK showcase** |
| ------------------------------------------ | :------------------: | :----------------: | :--------------------: | :-----------------------: |
| S3 content bucket (private, OAC)           |          ✅          |         ✅         |           ✅           |            ✅             |
| Versioned / RETAIN by default              |     ❌ (DESTROY)     |     ⚠️ partial     |         manual         |        ✅ default         |
| S3 + CloudFront access logging             |          ❌          |         ✅         |         manual         |        ✅ default         |
| Security-headers policy                    |          ❌          |         ✅         |         manual         |        ✅ default         |
| ACM cert (DNS-validated, `us-east-1`, SAN) |     ✅ (no SAN)      |         ❌         |         manual         |            ✅             |
| Route 53 alias records                     |          ✅          |         ❌         |         manual         |            ✅             |
| Content deploy + invalidation              |          ✅          |         ❌         |         manual         |            ✅             |
| CloudFront functions / multi-behavior      |          ❌          |         ❌         |         manual         |            ✅             |
| CloudWatch alarms (recommended set)        |          ❌          |         ❌         |  manual (~per metric)  |     ✅ one call each      |
| SNS routing for all alarms                 |          ❌          |         ❌         |   repeated per alarm   |    ✅ one policy call     |
| Route 53 health-check alarm                |          ❌          |         ❌         |     3rd-party lib      |            ✅             |
| AWS Budgets guard                          |          ❌          |         ❌         |         manual         |            ✅             |
| Multi-stack / cross-region split           |          ❌          |         ❌         |         manual         |    ✅ `.withStacks()`     |
| **Well-architected baseline as default**   |          ❌          |     ⚠️ partial     |           ❌           |            ✅             |

## 7. Honest caveats (where the comparison is _not_ one-sided)

A credible public-doc comparison should pre-empt the obvious rebuttals:

1. **Trivial scope favours B.** For "a private bucket behind a CDN, nothing else," `CloudFrontToS3` in
   three lines beats anything. Lead with the production shape, not the toy, or the conciseness claim
   looks cherry-picked.
2. **A is doing less, so its line count is unfairly flattering.** Always normalise: compare _at equal
   functionality_. The fair statement is "ComposureCDK reaches A's output in ~20 lines with more secure
   defaults, and reaches the _full_ showcase in ~110 where A would need ~250+."
3. **Learning curve.** A and B use only stock CDK; ComposureCDK adds `compose` / `ref` / builders concepts.
   The payoff is real but non-zero to learn — worth stating plainly rather than hiding.
4. **Library/version surface.** ComposureCDK is a set of `@composurecdk/*` packages to adopt and track;
   A is copy-paste, B is one dependency. The trade is "more deps, less bespoke code."
5. **Don't overclaim on functional difference.** Where ComposureCDK's _output_ matches B's defaults
   (logging, OAC, SSL), the win is authoring ergonomics and override visibility, not capability. Say so.

## 8. Recommendation for public documentation

1. **Add a "Compared to idiomatic CDK" section** (in `showcase.md` or a sibling page) built around the
   **feature matrix in §6** — it's the most defensible, skimmable artefact and makes the "no single
   example does all this" point immediately.
2. **Use one head-to-head snippet at equal functionality**: the canonical `aws-cdk-examples/static-site`
   beside the equivalent ComposureCDK `bucket`/`cdn`/`deploy` components, annotated to show which lines
   ComposureCDK _removes_ (they become defaults). This is the strongest single image.
3. **Frame the alarm/health/budget story as the differentiator**, since that's where reference examples
   genuinely run out — "from secure CDN to fully-alarmed, budget-guarded site is one
   `.recommendedAlarms()` and one `alarmActionsPolicy()` away, not 150 lines of `new Alarm(...)`."
4. **Keep the caveats from §7 in the published version.** A comparison that concedes B's three-line win
   and normalises for scope reads as confident and trustworthy; one that doesn't invites the rebuttal.
5. **Attribute and link** every reference example, and pin the AWS sample to a commit — it tracks the
   live `Distribution`/OAC API and will drift.

## Sources

- [aws-samples/aws-cdk-examples — typescript/static-site](https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/static-site/static-site.ts)
- [AWS Solutions Constructs — aws-cloudfront-s3](https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html)
- [AWS APN blog — Automating Secure and Scalable Website Deployment with CloudFront and CDK](https://aws.amazon.com/blogs/apn/automating-secure-and-scalable-website-deployment-on-aws-with-amazon-cloudfront-and-aws-cdk/)
- [pepperize/cdk-route53-health-check](https://github.com/pepperize/cdk-route53-health-check)
- [cdklabs/cdk-monitoring-constructs](https://github.com/cdklabs/cdk-monitoring-constructs)
- ComposureCDK: [`static-website/app.ts`](../packages/examples/src/static-website/app.ts), [`showcase.md`](showcase.md), [`architecture.md`](architecture.md)
