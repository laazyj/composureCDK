# @composurecdk/bedrock

Amazon Bedrock model access for [ComposureCDK](../../README.md): references to foundation models and cross-Region inference profiles, the IAM grants to invoke them, and CloudWatch alarms on their metrics.

It builds on the stable [`aws-cdk-lib/aws-bedrock`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrock-readme.html) module. Amazon Bedrock AgentCore is a separate service and is not covered here.

```ts
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { compose } from "@composurecdk/core";
import { createFunctionBuilder } from "@composurecdk/lambda";
import { createModelAlarmBuilder, inferenceProfile, modelGrants } from "@composurecdk/bedrock";

const haiku = inferenceProfile.geographic({
  model: FoundationModelIdentifier.ANTHROPIC_CLAUDE_HAIKU_4_5_20251001_V1_0,
  geography: "eu",
  routingRegions: [
    "eu-central-1",
    "eu-north-1",
    "eu-south-1",
    "eu-south-2",
    "eu-west-1",
    "eu-west-3",
  ],
});

compose(
  {
    handler: createFunctionBuilder()
      // runtime, handler, code …
      .environment({ MODEL_ID: haiku.profileId })
      .grant(modelGrants.invoke(haiku)),
    modelAlarms: createModelAlarmBuilder().model(haiku),
  },
  { handler: [], modelAlarms: [] },
);
```

## Model references

`modelGrants` and `createModelAlarmBuilder` take an `InferenceTarget`:

| Target                               | Invokes                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `FoundationModelIdentifier`          | A foundation model in the stack's Region                                           |
| `inferenceProfile.geographic({ … })` | A cross-Region profile that stays within one geography (`us`, `eu`, `apac`, …)     |
| `inferenceProfile.global(model)`     | A cross-Region profile that routes to any supported commercial Region              |
| `IModel`                             | Any model by ARN, e.g. `ProvisionedModel.fromProvisionedModelArn(…)` (grants only) |

A profile's id is derived from its model, so the id a caller invokes and the model it is granted cannot drift apart. Use `new FoundationModelIdentifier("…")` for a model newer than the installed CDK's constants.

`routingRegions` are the Regions a geographic profile routes to from your source Region. They vary by source Region and are not derivable from the geography, so they are supplied rather than guessed: take them from the model's page in the Bedrock user guide or from `aws bedrock get-inference-profile`. The source Region is always included.

For an id that arrives as a string, such as from an environment variable:

```ts
const profile = inferenceProfile.parse(
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  routingRegions,
);
foundationModelFor(profile.profileId).modelId; // "anthropic.claude-haiku-4-5-20251001-v1:0"
```

`parse` and `foundationModelFor` throw on an id without a known geography or `global` prefix (`INFERENCE_PROFILE_GEOGRAPHIES`), rather than mistake a provider such as `anthropic.` for one.

## Grants

`modelGrants.invoke(target)` grants `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, which together cover `InvokeModel`, `Converse` and their streaming variants. Pass it to any grantee builder's `grant(...)`.

| Target     | Statements                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model      | The foundation model in the source Region                                                                                                                                                                    |
| Geographic | The profile; the foundation model in the source Region and every routing Region, conditioned on `bedrock:InferenceProfileArn`                                                                                |
| Global     | The profile; the foundation model in the source Region; the Region-less foundation model ARN with `aws:RequestedRegion: unspecified`. Both model statements are conditioned on `bedrock:InferenceProfileArn` |

These follow the policies in the Bedrock user guide for [geographic](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html#geographic-cris-iam-setup) and [global](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html#global-cris-iam-setup) cross-Region inference. The `bedrock:InferenceProfileArn` condition makes the foundation models reachable only through the profile ([GENSEC01-BP01](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp01.html)); to also call a model directly, grant it separately.

`invocationArns(target, scope)` returns the same resource ARNs for policies you write yourself, such as service control policies.

## Alarms

`createModelAlarmBuilder()` creates alarms on the `AWS/Bedrock` metrics of one model. Those metrics are per model per account and Region, across every caller, so create one builder per model in each Region that invokes it — not one per caller. For a cross-Region profile the metrics are emitted in the source Region.

AWS publishes no recommended alarm thresholds for Bedrock. The [Generative AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp02.html) names the signals to alarm on; the thresholds below are this library's, shaped after AWS's recommended Lambda `Errors` and `Throttles` alarms.

| Alarm                    | Metric (statistic)             | Default                                |
| ------------------------ | ------------------------------ | -------------------------------------- |
| `invocationThrottles`    | `InvocationThrottles` (Sum)    | on, > 0 in 3 of 5 minutes              |
| `invocationServerErrors` | `InvocationServerErrors` (Sum) | on, > 0 in 3 of 5 minutes              |
| `invocationClientErrors` | `InvocationClientErrors` (Sum) | on, > 0 in 3 of 5 minutes              |
| `invocationLatency`      | `InvocationLatency` (p90)      | opt-in, threshold required             |
| `timeToFirstToken`       | `TimeToFirstToken` (p90)       | opt-in, threshold required             |
| `estimatedTpmQuotaUsage` | `EstimatedTPMQuotaUsage` (Max) | opt-in, `quota` required; 80% of quota |

`invocationClientErrors` includes `AccessDenied`, so it catches an under-granted routing Region, which fails only for requests routed there. Missing data is not breaching. Defaults are exported as `MODEL_ALARM_DEFAULTS`.

```ts
createModelAlarmBuilder()
  .model(haiku)
  .recommendedAlarms({
    invocationLatency: { threshold: 10_000 },
    estimatedTpmQuotaUsage: { quota: 400_000 },
  })
  .addAlarm("outputTokens", (a) =>
    a.metric((m) => m.metric("OutputTokenCount", { statistic: "Sum" })).threshold(1_000_000),
  );
```

No alarm actions are configured; route them with `alarmActionsPolicy`.

## Model invocation logging

`createModelInvocationLoggingBuilder()` turns on [model invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) for the account in the stack's Region ([GENSEC01-BP04](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp04.html)). The setting has no CloudFormation resource, so a custom resource applies it on deploy and deletes it with the stack.

```ts
createModelInvocationLoggingBuilder()
  .largeDataBucket(ref("audit", (r: BucketBuilderResult) => r.bucket))
  .largeDataKeyPrefix("bedrock");
```

It creates:

- a log group, from `@composurecdk/logs`' defaults; customise it with `logGroup: { configure }`;
- a role Bedrock assumes to write to the log group's `aws/bedrock/modelinvocations` stream, trusted only for this account and Region;
- an alarm on failed deliveries to the log group, and to the large-data bucket when one is configured.

Every modality is logged by default (`MODEL_INVOCATION_LOGGING_DEFAULTS`). Bodies over 100 KB and binary data are only logged to a `largeDataBucket`.

The setting is one per account and Region. Build it once: a second stack's configuration overwrites the first, and deleting either stack turns logging off.

## Not yet covered

- **Guardrails** ([GENSEC02-BP01](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec02-bp01.html)).
- **Application inference profiles**, for cost allocation tags.
- **Private connectivity** ([GENSEC01-BP02](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec01-bp02.html)): a `bedrock-runtime` interface endpoint, built with `@composurecdk/ec2`.
