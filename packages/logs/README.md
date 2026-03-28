# @composurecdk/logs

CloudWatch Logs builders for [ComposureCDK](../../README.md).

This package provides a fluent builder for CloudWatch log groups with secure, AWS-recommended defaults. It wraps the CDK [LogGroup](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.LogGroup.html) construct — refer to the CDK documentation for the full set of configurable properties.

## Log Group Builder

```ts
import { createLogGroupBuilder } from "@composurecdk/logs";

const logGroup = createLogGroupBuilder().logGroupName("/my-app/api").build(stack, "ApiLogs");
```

Every [LogGroupProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_logs.LogGroupProps.html) property is available as a fluent setter on the builder.

## Secure Defaults

`createLogGroupBuilder` applies the following defaults. Each can be overridden via the builder's fluent API.

| Property        | Default     | Rationale                                                                       |
| --------------- | ----------- | ------------------------------------------------------------------------------- |
| `retention`     | `TWO_YEARS` | Prevents unbounded log accumulation while preserving a meaningful audit window. |
| `removalPolicy` | `RETAIN`    | Logs are audit records that should survive infrastructure teardown.             |

These defaults are guided by the [AWS Well-Architected Security Pillar — SEC04-BP01](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html).

The defaults are exported as `LOG_GROUP_DEFAULTS` for visibility and testing:

```ts
import { LOG_GROUP_DEFAULTS } from "@composurecdk/logs";
```

### Overriding defaults

```ts
import { RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";

const logGroup = createLogGroupBuilder()
  .retention(RetentionDays.SIX_MONTHS)
  .removalPolicy(RemovalPolicy.DESTROY)
  .build(stack, "EphemeralLogs");
```

### Encryption

CloudWatch Logs encrypts all log data at rest using AWS-managed keys. For additional control (key rotation, CloudTrail audit, access revocation), provide a customer-managed KMS key:

```ts
const logGroup = createLogGroupBuilder().encryptionKey(myKmsKey).build(stack, "EncryptedLogs");
```
