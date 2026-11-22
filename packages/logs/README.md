# @composurecdk/logs

CloudWatch Logs builders for [ComposureCDK](https://github.com/laazyj/composureCDK/blob/main/README.md).

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

`.encryptionKey(...)` accepts a concrete key or a `Resolvable`, so a key built by [`@composurecdk/kms`](https://github.com/laazyj/composureCDK/blob/main/packages/kms/README.md) can be a component of the same system:

```ts
compose(
  {
    logKey: createKeyBuilder().description("Encrypts the audit log group."),
    audit: createLogGroupBuilder().encryptionKey(ref<KeyBuilderResult>("logKey").get("key")),
  },
  { logKey: [], audit: ["logKey"] },
);
```

### Resource policies

The builder has no resource-policy method, on purpose. A CloudWatch Logs resource policy (`AWS::Logs::ResourcePolicy`) belongs to the account and Region, not to a log group: the log groups it covers are the ARNs its statements name. AWS allows [10 per account per Region](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/cloudwatch_limits_cwl.html), shared with every stack and service in it. CDK's `logGroup.addToResourcePolicy(...)` creates a new one for each log group it is called on, so a method here would spend that quota one log group at a time, and the failure would surface in whichever deployment found it used up.

You rarely need one yourself. Access from another account goes through a subscription filter and a Logs destination, which has its own policy, and a principal in the app needs an IAM grant. What a log-group policy is for is letting an AWS service write to the group, and the integrations that do so add their own:

- **EventBridge targets** — `cloudWatchLogGroupTarget` from [`@composurecdk/events`](https://github.com/laazyj/composureCDK/blob/main/packages/events/README.md#target-helpers), through CDK's `CloudWatchLogGroup`.
- **Route 53 query logging** — [`@composurecdk/route53`](https://github.com/laazyj/composureCDK/blob/main/packages/route53/README.md#query-logging) creates one shared policy per stack for every zone's log group.

Where a service still needs one, create a single shared `ResourcePolicy` whose statements name the log groups it covers, rather than one per group. Once there are more than a few, give them a common name prefix and name `log-group:<prefix>*` instead, so a new group needs no policy change and the document stays within its size limit:

```ts
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ResourcePolicy } from "aws-cdk-lib/aws-logs";

new ResourcePolicy(stack, "ServiceLogsPolicy", {
  policyStatements: [
    new PolicyStatement({
      principals: [new ServicePrincipal("delivery.logs.amazonaws.com")],
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [auditLogs.logGroupArn, accessLogs.logGroupArn],
    }),
  ],
});
```
