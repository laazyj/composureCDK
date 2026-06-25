# Showcase

Real-world projects built with ComposureCDK. The case studies here extend the smaller, pattern-focused stacks in [`packages/examples/`](../packages/examples/README.md) — they show what a complete system looks like once ComposureCDK's defaults, lifecycles, and builders are in production.

## Add the badge

If your project uses ComposureCDK, paste this into your README:

```markdown
[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)
```

It renders as:

[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)

## Case studies

<!--
Skeleton for new entries. Copy below the closing `-->`, fill in, and remove the comment.

### [Project Name](https://github.com/your-org/your-repo)

Two to four sentences describing the project — what it does, the AWS surface it runs on, and how it uses ComposureCDK. Mention which packages it leans on most (e.g. `@composurecdk/lambda` + `@composurecdk/apigateway`) and any pattern that's specific to this deployment.

```ts
// Optional: a representative excerpt (≤ ~15 lines) showing the project's
// composureCDK use. Aim for a snippet that wouldn't fit as a generic example
// — something that captures *this* project's shape.
```

-->

### [jasonduffett.net](https://github.com/laazyj/jasonduffett.net)

A static personal site (Eleventy) hosted on S3 + CloudFront with Route 53 DNS, an ACM certificate, health-check alarms, and a hard monthly budget guard — the whole stack composed from ComposureCDK builders. It exercises most of the surface area: `@composurecdk/cloudfront`, `@composurecdk/s3`, `@composurecdk/route53`, `@composurecdk/acm`, `@composurecdk/budgets`, `@composurecdk/sns`, plus `@composurecdk/iam` for the GitHub OIDC deploy role. The builder defaults do most of the heavy lifting — versioned/RETAIN buckets, server access logging, DNS query logging, and scoped IAM — so the stack code stays focused on what's specific to the site (redirects, the `us-east-1` certificate, alarm wiring) instead of restating well-architected baselines.

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
  bucket: createBucketBuilder(), // versioned, RETAIN, access logs by default
  cdn: createDistributionBuilder()
    .domainNames([domain, www])
    .certificate(certificate)
    .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b))),
  aliasRecords: zoneRecords([ALIAS("@", cloudfrontAliasTarget(distribution))]).zone(hostedZone),
  // …budgets, SNS topics, health checks, alarms elided
}).withStacks({ zone: dnsStack, cert: certStack, cdn: siteStack /* … */ });
```

### [ukehoot.net](https://github.com/laazyj/ukehoot.net)

The website for UkeHoot is a static Eleventy site on S3 + CloudFront with Route 53 DNS, an `us-east-1` ACM certificate, CloudWatch alarms, and a monthly budget guard. The infrastructure follows the same multi-region, multi-stack shape as [jasonduffett.net](#jasonduffettnet). Its distinguishing difference is a CloudFront function that serves 301 redirects for the group's legacy Tumblr URLs (2012–2018) to their archived equivalents.

### [uke-o-ono.com](https://github.com/laazyj/ukeoono.com)

The single-page flyer for Edinburgh ukulele band Uke O Ono is another static Eleventy site on S3 + CloudFront, sharing the same builder defaults and multi-stack shape as [jasonduffett.net](#jasonduffettnet) — including a CloudFront function for the www→apex 301 and pretty-URL rewrite, CloudWatch alarms, and a monthly budget guard. Its distinguishing difference is **DNS hosted at Cloudflare rather than Route 53**: there is no `@composurecdk/route53` hosted-zone or alias-record builder, so the apex and `www` records are CNAMEs pointed at the distribution by hand in Cloudflare. With no zone to DNS-validate against, the `us-east-1` ACM certificate is validated manually in Cloudflare and imported by ARN, rather than created and validated by the `@composurecdk/acm` builder.

```ts
// No Route 53 zone, so the cert is validated by hand in Cloudflare and
// imported by ARN instead of created/DNS-validated by the builder.
const certificate = Certificate.fromCertificateArn(siteStack, "SiteCert", certArn);

return compose({
  bucket: createBucketBuilder(), // versioned, RETAIN, access logs by default
  cdn: createDistributionBuilder()
    .domainNames([domain, www])
    .certificate(certificate)
    .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b))),
  // …CloudFront redirect function, budgets, SNS topics, alarms elided
}).withStacks({ cdn: siteStack /* …alerts, alarms, OIDC stacks */ });
```

## Submitting your project

Open a pull request adding an entry under **Case studies** above, or open an issue if you'd prefer the maintainer to write the entry up. Entries should link to a public repo or homepage so readers can verify the project exists.
