# @composurecdk/acm

AWS Certificate Manager builder for [ComposureCDK](https://github.com/laazyj/composureCDK/blob/main/README.md).

This package provides a fluent builder for ACM certificates with secure, AWS-recommended defaults, first-class DNS validation wiring, and a recommended `DaysToExpiry` alarm. It wraps the CDK [Certificate](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.Certificate.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Certificate Builder

```ts
import { createCertificateBuilder } from "@composurecdk/acm";
import { HostedZone } from "aws-cdk-lib/aws-route53";

const zone = HostedZone.fromLookup(stack, "Zone", { domainName: "example.com" });

const { certificate } = createCertificateBuilder()
  .domainName("example.com")
  .subjectAlternativeNames(["www.example.com"])
  .validationZone(zone)
  .build(stack, "SiteCert");
```

Every [CertificateProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.CertificateProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createCertificateBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property                     | Default                 | Rationale                                                                     |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `keyAlgorithm`               | `KeyAlgorithm.RSA_2048` | Broadest client and AWS service compatibility (CloudFront, API Gateway, ALB). |
| `transparencyLoggingEnabled` | `true`                  | Required by modern browsers; enables public detection of mis-issuance.        |

These defaults are guided by the [AWS ACM Best Practices](https://docs.aws.amazon.com/acm/latest/userguide/acm-bestpractices.html).

The defaults are exported as `CERTIFICATE_DEFAULTS` for visibility and testing:

```ts
import { CERTIFICATE_DEFAULTS } from "@composurecdk/acm";
```

## DNS Validation

Email-based validation is not used by default — it blocks stack creation until a human clicks a link in an email. The builder requires one of:

- `validationZone(zone)` — the hosted zone that owns every domain on the certificate.
- `validationZones({ "apex.com": apexZone, "alt.net": altZone })` — when domains span multiple zones.
- `validation(CertificateValidation.fromEmail())` — explicit opt-in to email validation (not recommended).

`validationZone` / `validationZones` accept a `Resolvable<IHostedZone>`, so a hosted zone produced by a sibling component can be wired via `ref()`.

## Certificate Lifetime

ACM-issued public certificates are valid for [395 days](https://docs.aws.amazon.com/acm/latest/userguide/acm-certificate.html) and auto-renew starting ~60 days before expiry, provided the DNS validation records remain published. Renewal is therefore the happy path — the `daysToExpiry` alarm below is a safety net for the cases where it can't complete (records removed, zone delegation broken, etc.). For imported certificates, which do not auto-renew, `daysToExpiry` is the primary expiry control.

## Recommended Alarms

The builder creates [AWS-recommended CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager) by default. No alarm actions are configured — access alarms from the build result to add SNS topics or other actions.

| Alarm          | Metric                        | Default threshold |
| -------------- | ----------------------------- | ----------------- |
| `daysToExpiry` | DaysToExpiry (Minimum, 1 day) | ≤ 45 days         |

`treatMissingData` defaults to `notBreaching`: once a certificate has effectively expired, ACM stops emitting `DaysToExpiry`, and there is nothing left to alarm about.

The defaults are exported as `CERTIFICATE_ALARM_DEFAULTS` for visibility and testing:

```ts
import { CERTIFICATE_ALARM_DEFAULTS } from "@composurecdk/acm";
```

### Customizing thresholds

Override individual alarm properties via `recommendedAlarms`. Unspecified fields keep their defaults.

```ts
const cert = createCertificateBuilder()
  .domainName("example.com")
  .validationZone(zone)
  .recommendedAlarms({
    daysToExpiry: { threshold: 30 },
  });
```

### Disabling alarms

Disable all recommended alarms:

```ts
builder.recommendedAlarms(false);
// or
builder.recommendedAlarms({ enabled: false });
```

Disable the daysToExpiry alarm individually:

```ts
builder.recommendedAlarms({ daysToExpiry: false });
```

### Custom alarms

Add custom alarms alongside the recommended ones via `addAlarm`. The callback receives an `AlarmDefinitionBuilder` typed to `ICertificate`, so the metric factory has access to the certificate at build time.

```ts
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import { Duration } from "aws-cdk-lib";

const cert = createCertificateBuilder()
  .domainName("example.com")
  .validationZone(zone)
  .addAlarm("urgentExpiry", (alarm) =>
    alarm
      .metric(
        (c) =>
          new Metric({
            namespace: "AWS/CertificateManager",
            metricName: "DaysToExpiry",
            dimensionsMap: { CertificateArn: c.certificateArn },
            statistic: "Minimum",
            period: Duration.days(1),
          }),
      )
      .threshold(10)
      .lessThanOrEqual()
      .description("Certificate very close to expiry — page oncall"),
  );
```

### Reading alarms by key

`CertificateBuilderResult` types `alarms` by key, so a misspelled key is a compile error rather than `undefined` at synth. A recommended alarm is `Alarm | undefined`, because it can be disabled. To read a custom alarm, name its key with `WithCustomAlarms`, from `@composurecdk/cloudwatch`, and it is typed `Alarm`:

```ts
ref("cert", (r: CertificateBuilderResult) => r.alarms.daysToExpiry); // Alarm | undefined
ref(
  "cert",
  (r: WithCustomAlarms<CertificateBuilderResult, "urgentExpiry">) => r.alarms.urgentExpiry,
); // Alarm
ref("cert", (r: CertificateBuilderResult) => r.alarms.daysToExpiri); // compile error
```

The custom keys you name are not checked against the builder's `addAlarm` calls. The result of the builder's own `build()` accepts any key, as `WithCustomAlarms<CertificateBuilderResult, string>`. The recommended keys are exported as `CertificateAlarmKey`.

### Applying alarm actions

Alarms are returned in the build result's `alarms`, keyed by alarm:

```ts
const result = cert.build(stack, "SiteCert");

const alertTopic = new Topic(stack, "AlertTopic");
for (const alarm of Object.values(result.alarms)) {
  alarm.addAlarmAction(new SnsAction(alertTopic));
}
```

## CloudFront certificates

CloudFront viewer certificates must live in `us-east-1`. The ACM builder cannot enforce this on its own — certificates in other regions are perfectly valid for ALB, API Gateway, and other services. The constraint is enforced by CloudFront at association time, so if your certificate is for CloudFront, place the builder in a stack that targets `us-east-1` (e.g. via [`createStackBuilder`](https://github.com/laazyj/composureCDK/blob/main/packages/cloudformation/README.md) with an `env`).
