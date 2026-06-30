# Showcase

Real-world projects and patterns built with ComposureCDK, grouped by the kind of system they build. Each category opens with what ComposureCDK gives you for that use case, a short canonical example, a link to a runnable example app, a deep-dive comparison against idiomatic CDK, and the real-world projects that run it in production. More categories will be added as the library grows.

## Add the badge

If your project uses ComposureCDK, paste this into your README:

```markdown
[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)
```

It renders as:

[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)

## Categories

### Static sites on S3 + CloudFront

A static site fronted by CloudFront over a private S3 origin is the canonical "simple until it isn't" deployment: the happy path is a bucket and a distribution, but a production site also wants TLS on a custom domain, DNS, content deployment, alarms, a health check and a cost guard — and in idiomatic CDK each of those is more boilerplate to write and keep correct. ComposureCDK collapses that: the well-architected baseline (private/OAC bucket, versioned + RETAIN, S3 and CloudFront access logging, SSL enforcement, security-headers policy, scoped IAM, the recommended alarm set) comes from builder **defaults**, so the stack code reads as only the decisions specific to _your_ site. Going from a secure CDN to a fully-alarmed, budget-guarded, multi-stack deployment is a `.recommendedAlarms()` on each resource and one `alarmActionsPolicy()` to route every alarm — not 150 lines of `new Alarm(...)`.

```ts
const hostedZone = ref<HostedZoneBuilderResult>("zone").get("hostedZone");
const bucket = ref<BucketBuilderResult>("bucket").get("bucket");
const certificate = ref<CertificateBuilderResult>("cert").get("certificate");
const distribution = ref<DistributionBuilderResult>("cdn").get("distribution");

return compose({
  zone: createHostedZoneBuilder().zoneName(domain),
  cert: createCertificateBuilder() // us-east-1, DNS-validated against the zone
    .domainName(domain)
    .subjectAlternativeNames([www])
    .validationZone(hostedZone),
  bucket: createBucketBuilder(), // private/OAC, versioned, RETAIN, access logs by default
  cdn: createDistributionBuilder()
    .domainNames([domain, www])
    .certificate(certificate)
    .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b)))
    .recommendedAlarms({ errorRate: { threshold: 2 } }),
  aliasRecords: zoneRecords([ALIAS("@", cloudfrontAliasTarget(distribution))]).zone(hostedZone),
  // …budgets, SNS topics, health checks elided
}).withStacks({ zone: dnsStack, cert: certStack, cdn: siteStack /* … */ });
```

**Try it:** the runnable [`ComposureCDK-StaticWebsiteStack`](../packages/examples/src/static-website/app.ts) example synthesises a complete, test-verified stack — OAC bucket, multi-behavior distribution with CloudFront functions, custom error pages, content deployment, and recommended CloudFront/S3/function alarms routed to an SNS topic.

**How it compares:** [ComposureCDK vs. idiomatic CDK — static-website comparison](comparison-report.md) is a deep dive against the canonical AWS sample, the AWS Solutions Constructs `CloudFrontToS3` pattern, and hand-rolled community monitoring stacks — with a feature matrix, equal-functionality code comparison, and honest caveats.

**Going further — composing systems:** a `compose()` result is itself a `Lifecycle`, so a whole site can nest as a component in a larger graph. [jasonduffett.net](https://github.com/laazyj/jasonduffett.net) uses this to add `clara.jasonduffett.net` as a second, self-contained site — its own bucket, distribution, certificate and hosted zone — beside the apex, with one outer component delegating the subdomain via NS records:

```ts
compose(
  {
    // The already-deployed apex. at() pins its construct id to the already deployed id,
    // so nesting it under a new key doesn't rotate logical ids and churn it.
    apexSite: at("mainSiteExistingId", createSystem()),
    subSite: createSubSite(),
    // Delegate the subdomain from the apex zone to the subsite's child zone
    subSiteDelegation: createNsRecordBuilder()
      .zone(ref("apexSite").get("zone").get("hostedZone"))
      .recordName("sub.example.com")
      .values(
        ref("subSite")
          .get("zone")
          .get("hostedZone")
          .map((z) => z.hostedZoneNameServers ?? []),
      ),
  },
  { apexSite: [], subSite: [], subSiteDelegation: ["apexSite", "subSite"] },
).build(app, "MyBiggerSite");
```

The use of [`at(id, component)`](architecture.md#pinning-a-components-construct-id-with-at) demonstrates how to pin the build id of the already-deployed apex, so its resources keep their existing logical ids instead of being replaced when the construct path lengthens to `MyBiggerSite/apexSite/<key>`.

**Built with ComposureCDK:**

- **[jasonduffett.net](https://github.com/laazyj/jasonduffett.net)** — the reference build, exercising most of the surface area: `@composurecdk/cloudfront` + `s3` + `route53` + `acm` + `budgets` + `sns`, plus `@composurecdk/iam` for the GitHub-OIDC deploy role, across a multi-region, multi-stack shape. It also runs the composition pattern above — the apex and the `clara.` subsite are two nested `compose()` systems joined by an NS delegation, with the apex's construct ids pinned so adding the subsite churned no live resources.
- **[ukehoot.net](https://github.com/laazyj/ukehoot.net)** — the same shape, distinguished by a CloudFront function serving 301 redirects for the group's legacy Tumblr URLs (2012–2018) to their archived equivalents.
- **[uke-o-ono.com](https://github.com/laazyj/ukeoono.com)** — DNS hosted at **Cloudflare rather than Route 53**: apex/`www` are CNAMEs pointed at the distribution by hand, and the `us-east-1` ACM certificate is validated manually and imported by ARN rather than created and DNS-validated by the builder.

## Submitting your project

Open a pull request adding your project under the relevant category above (or proposing a new category), or open an issue if you'd prefer the maintainer to write the entry up. Entries should link to a public repo or homepage so readers can verify the project exists.

<!--
Skeleton for a new consumer entry:

- **[Project Name](https://github.com/your-org/your-repo)** — one sentence naming the project's
  distinguishing difference from the others in its category.

Skeleton for a new category: copy the "Static sites on S3 + CloudFront" structure — an opening
paragraph on the use case, a short canonical snippet, a link to the example app, a link to a
comparison deep-dive (if one exists), and the list of real-world consumers.
-->
