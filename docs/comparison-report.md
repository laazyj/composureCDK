# ComposureCDK vs. idiomatic CDK — static-website comparison

> A deep-dive companion to the [Showcase](showcase.md). It compares the ComposureCDK
> static-website pattern against the canonical AWS and community CDK examples for the
> same architecture — what each builds, and how they read at equal functionality.

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

**Is it production-capable for even a trivial site? Not really.** The bare `{}` form serves only the
generated `*.cloudfront.net` name — no custom domain, no ACM certificate, no DNS. The first thing any
real site needs is its own domain, and that is exactly where the three-line story ends. To add one you
pass a `cloudFrontDistributionProps` object and spread raw L2 `DistributionProps` into it:

```typescript
new CloudFrontToS3(this, "site", {
  cloudFrontDistributionProps: {
    domainNames: ["example.com"],
    certificate: siteCert, // you still create + DNS-validate this yourself, in us-east-1
    defaultRootObject: "index.html",
    errorResponses: [
      { httpStatus: 403, responsePagePath: "/error.html", ttl: Duration.minutes(30) },
    ],
  },
});
```

— and you _still_ hand-write the `acm.Certificate` (in `us-east-1`) and the `route53.ARecord` yourself,
because the construct creates neither. So for even a trivial _real_ site you are back to A's
certificate/DNS code plus a nested props bag, with no alarms, health checks or budget. B is genuinely
concise only for an internal/throwaway distribution on the default CloudFront domain.

**Code coherence.** Highest of all references _while you stay inside its defaults_ — one construct, one
identity, nothing to wire. But it's coherent because it's _closed_: customisation happens through the
`cloudFrontDistributionProps` / `bucketProps` override surface, so the readability gain erodes exactly
where the showcase adds value (custom domain, second origin, alarm thresholds).

**Conciseness.** Three lines — but only for the domainless throwaway above. As soon as a custom domain
is required the count jumps to A's cert/DNS code plus a nested props bag. The honest concession is narrow:
B wins _only_ the "internal distribution on the default CloudFront domain" case, not the production shape.

**Readability.** Maximal at first glance, lower under modification — the meaning of a `CloudFrontToS3`
depends on knowing its (large) default set, and overrides are nested raw-L2 props rather than a fluent,
self-documenting chain.

**A minimal, functionally-comparable ComposureCDK version.** Matching B's realistic trivial case — a
private bucket behind a CDN _on a custom domain, with TLS and DNS_ — is itself only a handful of
components, and unlike B it actually provisions the certificate and DNS records and ships secure defaults
(versioned/RETAIN bucket, access logging) without extra lines:

```typescript
const bucket = ref<BucketBuilderResult>("bucket").get("bucket");
const distribution = ref<DistributionBuilderResult>("cdn").get("distribution");

compose(
  {
    cert: createCertificateBuilder().domainName(domain).validationZone(hostedZone), // us-east-1, DNS-validated
    bucket: createBucketBuilder(), // private, versioned/RETAIN, access-logged by default
    cdn: createDistributionBuilder()
      .domainNames([domain])
      .certificate(ref("cert", (r: CertificateBuilderResult) => r.certificate))
      .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b))),
    dns: zoneRecords([ALIAS("@", cloudfrontAliasTarget(distribution))]).zone(hostedZone),
  },
  { cert: [], bucket: [], cdn: ["cert", "bucket"], dns: ["cdn"] },
);
```

Same output surface as B's _customised_ form, fewer moving parts than B-plus-hand-rolled-cert/DNS, and
the secure baseline is free rather than spread into a props bag.

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

1. **The domainless throwaway favours B.** For an internal distribution on the default
   `*.cloudfront.net` name — no custom domain, cert, DNS or alarms — `CloudFrontToS3` in three lines
   beats anything (see §4). That's the one case to concede, and it evaporates the moment a real domain
   is added. Lead with the production shape, not the toy, or the conciseness claim looks cherry-picked.
2. **A is doing less, so its line count is unfairly flattering.** Always normalise: compare _at equal
   functionality_. A's resource + output code is ~46 lines (excluding imports and class scaffolding);
   the ComposureCDK equivalent for byte-identical output is ~20 — **roughly 43% of the code, a ~57%
   reduction** (≈22% of the full ~90-line file once imports/scaffolding are counted), and that is
   _before_ crediting the secure defaults A omits. At the _full_ showcase scope ComposureCDK is ~110
   lines where A-plus-C would need ~250+.
3. **Learning curve.** A and B use only stock CDK; ComposureCDK adds `compose` / `ref` / builders concepts.
   The payoff is real but non-zero to learn — worth stating plainly rather than hiding.
4. **Library/version surface.** ComposureCDK is a set of `@composurecdk/*` packages to adopt and track;
   A is copy-paste, B is one dependency. The trade is "more deps, less bespoke code."
5. **Don't overclaim on functional difference.** Where ComposureCDK's _output_ matches B's defaults
   (logging, OAC, SSL), the win is authoring ergonomics and override visibility, not capability. Say so.

## 8. Takeaways

- **No reference example covers the showcase's scope in one place.** A and B stop at a secure CDN; the
  alarms, SNS routing, health checks and budget guard that make a site _operable_ are left to you.
- **Normalise before comparing lines.** At equal output ComposureCDK is well under half of A's code
  (§7.2); the larger win is everything A doesn't do.
- **B's three-line headline is a domainless throwaway.** A custom domain pulls back the raw-L2 props
  spread plus hand-written cert/DNS (§4) — B is production-capable only on the default CloudFront domain.
- **The differentiator is the operability layer.** Going from "secure CDN" to "fully-alarmed,
  budget-guarded, multi-stack site" is a `.recommendedAlarms()` and one `alarmActionsPolicy()` in
  ComposureCDK, versus ~120–180 lines of `new Alarm(...)` and third-party wiring in idiomatic CDK.

This page is the long-form companion to the [Showcase](showcase.md), which carries the short canonical
example and the list of real-world consumers.

## Sources

- [aws-samples/aws-cdk-examples — typescript/static-site](https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/static-site/static-site.ts)
- [AWS Solutions Constructs — aws-cloudfront-s3](https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html)
- [AWS APN blog — Automating Secure and Scalable Website Deployment with CloudFront and CDK](https://aws.amazon.com/blogs/apn/automating-secure-and-scalable-website-deployment-on-aws-with-amazon-cloudfront-and-aws-cdk/)
- [pepperize/cdk-route53-health-check](https://github.com/pepperize/cdk-route53-health-check)
- [cdklabs/cdk-monitoring-constructs](https://github.com/cdklabs/cdk-monitoring-constructs)
- ComposureCDK: [`static-website/app.ts`](../packages/examples/src/static-website/app.ts), [`showcase.md`](showcase.md), [`architecture.md`](architecture.md)
