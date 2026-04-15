# @composurecdk/acm

AWS Certificate Manager builder for [ComposureCDK](../../README.md).

This package provides a fluent builder for ACM certificates with secure, AWS-recommended defaults and first-class DNS validation wiring. It wraps the CDK [Certificate](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Certificate Builder

```ts
import { createCertificateBuilder } from "@composurecdk/acm";
import { createHostedZoneBuilder, type HostedZoneBuilderResult } from "@composurecdk/route53";
import { compose, ref } from "@composurecdk/core";

const zone = createHostedZoneBuilder().zoneName("example.com");
const cert = createCertificateBuilder()
  .domainName("example.com")
  .subjectAlternativeNames(["www.example.com"])
  .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone));

compose({ zone, cert }, { zone: [], cert: ["zone"] }).build(stack, "Site");
```

Every [CertificateProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.CertificateProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createCertificateBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                     | Default                 | Rationale                                                                     |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `keyAlgorithm`               | `KeyAlgorithm.RSA_2048` | Broadest client and AWS service compatibility (CloudFront, API Gateway, ALB). |
| `transparencyLoggingEnabled` | `true`                  | Required by modern browsers; enables public detection of mis-issuance.        |

The defaults are exported as `CERTIFICATE_DEFAULTS` for visibility and testing:

```ts
import { CERTIFICATE_DEFAULTS } from "@composurecdk/acm";
```

## DNS Validation

Email-based validation is not used by default — it blocks stack creation until a human clicks a link in an email. The builder requires one of:

- `validationZone(zone)` — the hosted zone that owns every domain on the certificate.
- `validationZones({ "apex.com": apexZone, "alt.net": altZone })` — when domains span multiple zones.
- `validation(CertificateValidation.fromEmail())` — explicit opt-in to email validation (not recommended).

`validationZone` / `validationZones` accept a `Resolvable<IHostedZone>`, so a hosted zone produced by a composed `@composurecdk/route53` component can be wired via `ref()`.

## CloudFront certificates

CloudFront viewer certificates must live in `us-east-1`. If your application stack is in another region, place the ACM certificate in a dedicated `us-east-1` stack (e.g. via `createStackBuilder()` with an `env`) and import it into the CloudFront stack through composed dependencies or cross-region references.

## Examples

- [StaticWebsiteStack](../examples/src/static-website/app.ts) — also consult the custom-domain variant for end-to-end ACM + Route53 + CloudFront composition.
