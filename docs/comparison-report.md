# ComposureCDK vs. idiomatic CDK — static-website comparison

> A deep-dive companion to the [Showcase](showcase.md). If you're building a static site on
> S3 + CloudFront and weighing ComposureCDK against the examples you'd otherwise copy, this
> page lays the realistic options side by side — what each one builds, how the code reads, and
> where ComposureCDK is _not_ the better choice.

## 1. The options you're actually choosing between

The [showcase](showcase.md) and the [`ComposureCDK-StaticWebsiteStack`](../packages/examples/src/static-website/app.ts) example both target the same well-trodden architecture: **a static site on S3, fronted by CloudFront, with TLS, DNS, content deployment, alarms, health checks and a budget guard.** It's the most common "simple until it isn't" shape in the CDK ecosystem, which makes it a good place to compare honestly.

Three reference points span what an engineer realistically reaches for instead:

| #   | Reference                                                                                                                                                                                                                                                                                                                                                                                                | What it is                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A   | [`aws-samples/aws-cdk-examples` → `typescript/static-site`](https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/static-site/static-site.ts)                                                                                                                                                                                                                                             | The **canonical, hand-written L2** example AWS ships and most blogs clone.  |
| B   | [`@aws-solutions-constructs/aws-cloudfront-s3` (`CloudFrontToS3`)](https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html)                                                                                                                                                                                                                                                       | The **opinionated L3 pattern** — maximum concision, fixed scope.            |
| C   | Community / AWS-blog hand-rolled stacks (e.g. the [APN "secure & scalable" CDK post](https://aws.amazon.com/blogs/apn/automating-secure-and-scalable-website-deployment-on-aws-with-amazon-cloudfront-and-aws-cdk/), [pepperize `cdk-route53-health-check`](https://github.com/pepperize/cdk-route53-health-check), [`cdk-monitoring-constructs`](https://github.com/cdklabs/cdk-monitoring-constructs)) | What you assemble when you need **monitoring + health checks** on top of A. |

The single most important finding: **no off-the-shelf example covers the showcase's feature set in one place.** A and B stop well short of alarms, health checks and cost guards; reaching that point means hand-assembling C's pieces yourself. So part of this is "same job, fewer lines" (A, B) and part is "a job no single reference example actually does" (C).

## 2. What the ComposureCDK showcase builds

Two artefacts make up the showcase:

- **The runnable example** — [`static-website/app.ts`](../packages/examples/src/static-website/app.ts), ~110 lines including generous doc comments and _two_ inline CloudFront functions. Synth-verified (see [`static-website-app.test.ts`](../packages/examples/test/static-website-app.test.ts)) to produce: 3 buckets (content + S3 access-log + CloudFront access-log), all private/encrypted/SSL-enforced; OAC; security-headers response policy; HTTP/2+3; PriceClass_100; HTTP→HTTPS; custom 403/404 error pages; a multi-behavior distribution (`/api/*` → HTTP origin); and **recommended CloudWatch alarms** for CloudFront (5xx error rate, origin latency), S3 (4xx/5xx) and each CloudFront function, all routed to an SNS topic via one `alarmActionsPolicy(...)` call.
- **The case studies** ([jasonduffett.net](https://github.com/laazyj/jasonduffett.net), ukehoot.net, uke-o-ono.com) — the _full_ production shape: Route 53 zone, `us-east-1` ACM cert with `www` SAN, health-check alarms, a hard monthly **AWS Budgets** guard, GitHub-OIDC deploy role, multi-stack split.

The property that matters for the comparison: **the well-architected baseline is the default, not the code.** Versioned/RETAIN buckets, server access logging, DNS query logging, OAC, SSL enforcement, scoped IAM and the recommended alarm set come from builder defaults ([architecture.md](architecture.md#defaults)), so the source reads as _only the site-specific decisions_ — redirects, the cross-region cert, alarm thresholds — rather than restating baselines on every resource.

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

It covers S3 + OAC + CloudFront + DNS-validated ACM + Route 53 alias + content deploy with invalidation — and nothing operational. No CloudWatch alarm, SNS topic, Route 53 health check or budget guard; no CloudFront/S3 access logging, security-headers policy, `www` SAN, second behavior or CloudFront functions. Two of its defaults are ones a production site usually reverses: a `DESTROY` + `autoDeleteObjects` content bucket (ComposureCDK defaults to versioned/RETAIN) and an unlogged distribution.

For what it does, it's clear and approachable — plain constructs, no framework to learn. The two things that don't scale are visible even here: the components are wired by hand through local variables (`siteBucket`, `distribution`), so dependency order lives in line order rather than as data; and intent sits at the same altitude as boilerplate — `minimumProtocolVersion`, `allowedMethods` and `compress` are restated in full, with nothing marking which values are deliberate and which are just the recommended default. ComposureCDK inverts that last point: the defaults are invisible and only your deviations show.

The honest size comparison is at _equal functionality_. A's resource + output code is ~46 lines (excluding imports and class scaffolding); the ComposureCDK equivalent for byte-identical output is ~20 — **roughly 43% of the code, a ~57% reduction** — and that's before crediting the secure defaults A leaves out. The reduction comes mostly from those defaults (logging, SSL enforcement, security headers, RETAIN) being free rather than hand-typed.

## 4. Reference B — `CloudFrontToS3` (AWS Solutions Constructs)

The opposite extreme — a single L3 construct. The minimal deployment really is three lines:

```typescript
import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";

new CloudFrontToS3(this, "static-site", {});
```

Out of the box it provisions a private content bucket, an S3 access-log bucket, a CloudFront distribution with OAC, a CloudFront access-log bucket, HTTP→HTTPS, and injected HTTP security headers. That core overlaps the showcase's _defaults_ closely — useful external corroboration that ComposureCDK's baked-in baseline matches AWS's own opinion. What it deliberately doesn't do: ACM, custom domain/DNS, alarms, SNS, health checks, budgets, content deployment, CloudFront functions.

The three-line figure holds for exactly one situation, and it's worth being precise about which. The bare `{}` form serves only the generated `*.cloudfront.net` name — no custom domain, certificate or DNS. The first thing a real site needs is its own domain, and adding it means handing the construct a `cloudFrontDistributionProps` object with raw L2 `DistributionProps` spread into it:

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

— and you _still_ write the `acm.Certificate` (in `us-east-1`) and the `route53.ARecord` yourself, because the construct creates neither. So for even a trivial _real_ site you're back to A's certificate/DNS code plus a nested props bag, still with no alarms, health checks or budget. The construct stays maximally readable while you live inside its defaults, but it's a _closed_ shape: customisation flows through the `cloudFrontDistributionProps` / `bucketProps` override surface, so the concision fades exactly where the showcase adds value (custom domain, a second origin, your own alarm thresholds). **B is genuinely the smallest option for one case: an internal/throwaway distribution on the default CloudFront domain.**

For comparison, matching B's _realistic_ trivial case in ComposureCDK — a private bucket behind a CDN on a custom domain, with TLS and DNS — is a handful of components, and unlike B it actually provisions the certificate and DNS records and ships the secure baseline for free rather than spread into a props bag:

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

## 5. Reference C — assembling the operational layer yourself

There is **no single canonical example** that matches the showcase's full feature set (verified across aws-samples, awslabs, Constructs Hub and the AWS blogs). To reach it from A you bolt on, by hand:

- an **SNS topic** + subscription;
- **CloudWatch alarms** — CloudFront `5xxErrorRate` and `OriginLatency`, S3 `4xx/5xxErrors` (which needs the request-metrics filter enabled), and per-function error/throttle alarms — each with its own `alarmActions`;
- a **Route 53 health check** + companion alarm (commonly via [`pepperize/cdk-route53-health-check`](https://github.com/pepperize/cdk-route53-health-check) or [`cdk-monitoring-constructs`](https://github.com/cdklabs/cdk-monitoring-constructs));
- an **AWS Budgets** monthly guard.

This is the only route that _reaches_ parity — by composing third-party libraries you select, version and wire yourself. It's also where the readability gap is widest. In idiomatic CDK each alarm is ~6–10 lines (metric → alarm → `addAlarmAction`), repeated per metric, so the operational layer alone is realistically **+120–180 lines** on top of A's ~90 — and it's the easy-to-get-subtly-wrong kind (right metric namespace, statistic, period, missing-data handling). The alarms also end up living far from the resources they watch, with the SNS action restated on each one.

The showcase collapses that into `.recommendedAlarms({ errorRate: { threshold: 2 } })` on the resource itself — the AWS-recommended metric set encoded once — plus a single `alarmActionsPolicy(stack, { defaults: { alarmActions: [new SnsAction(alerts.topic)] } })` that routes _every_ alarm in the stack. That's a different model, not just fewer characters: the intent lives next to the resource, and the wiring is declared once.

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

## 7. Where ComposureCDK isn't the right call

Being straight about the trade-offs:

- **It's a dependency, and a new vocabulary.** ComposureCDK is a set of `@composurecdk/*` packages to adopt and track, and `compose` / `ref` / builders are concepts your team has to learn. That cost is real and front-loaded. (Note that B and C's monitoring libraries are dependencies too — the honest question isn't "deps vs. no deps," it's which dependency buys the most.)
- **For a true throwaway, reach for B.** An internal distribution on the default `*.cloudfront.net` domain, with no custom domain and nothing operational, is three lines of `CloudFrontToS3` and that's the right tool. ComposureCDK starts paying off once the site is real — a custom domain, alarms, a budget — which, as §4 shows, arrives almost immediately.
- **On the shared core, the win is ergonomics, not capability.** Where ComposureCDK's output matches B's defaults (private/OAC bucket, logging, SSL, security headers), it isn't doing anything B can't — the difference is that the baseline is a default you can't forget rather than props you maintain, and overrides read as a fluent chain rather than a nested bag.

## 8. Takeaways

If you're building and _operating_ a real static site on S3 + CloudFront, ComposureCDK is the higher-leverage choice — and the reasons are concrete:

- **The well-architected baseline is free and unforgettable.** Versioned/RETAIN buckets, OAC, SSL enforcement, access logging and the recommended alarm set are defaults, so they can't be omitted by accident and don't cost you a line. At equal functionality the stack is roughly half the code of the canonical AWS example (§3), and the parts that vanish are exactly the parts you'd otherwise copy-paste and have to keep correct.
- **The operational layer is the real differentiator.** Going from "secure CDN" to "fully-alarmed, budget-guarded, multi-stack site" is a `.recommendedAlarms()` per resource and one `alarmActionsPolicy()` — versus the ~120–180 lines of `new Alarm(...)` and third-party wiring that no off-the-shelf example gives you (§5).
- **The code reads as intent.** Defaults are invisible; only your decisions show. Dependencies are declared as data via `compose`/`ref` instead of implied by statement order, which is what keeps the stack legible as the surface grows.

The honest counterweight: you're taking on a dependency and a small learning curve, and for a genuine throwaway a single-construct option is simpler (§7). For anything you intend to run in production, that trade goes ComposureCDK's way — and the [showcase](showcase.md) consumers are the working proof.

## Sources

- [aws-samples/aws-cdk-examples — typescript/static-site](https://github.com/aws-samples/aws-cdk-examples/blob/main/typescript/static-site/static-site.ts)
- [AWS Solutions Constructs — aws-cloudfront-s3](https://docs.aws.amazon.com/solutions/latest/constructs/aws-cloudfront-s3.html)
- [AWS APN blog — Automating Secure and Scalable Website Deployment with CloudFront and CDK](https://aws.amazon.com/blogs/apn/automating-secure-and-scalable-website-deployment-on-aws-with-amazon-cloudfront-and-aws-cdk/)
- [pepperize/cdk-route53-health-check](https://github.com/pepperize/cdk-route53-health-check)
- [cdklabs/cdk-monitoring-constructs](https://github.com/cdklabs/cdk-monitoring-constructs)
- ComposureCDK: [`static-website/app.ts`](../packages/examples/src/static-website/app.ts), [`showcase.md`](showcase.md), [`architecture.md`](architecture.md)
