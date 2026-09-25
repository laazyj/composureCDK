# @composurecdk/xray

AWS X-Ray for [ComposureCDK](../../README.md). It enables [CloudWatch Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html), which sends X-Ray spans to CloudWatch Logs so they can be searched and analysed. Amazon Bedrock AgentCore online evaluation needs it.

```ts
import { createTransactionSearchBuilder } from "@composurecdk/xray";

createTransactionSearchBuilder().build(stack, "TransactionSearch");
```

Transaction Search is one setting for the whole account and Region, so build it in exactly one stack:

- If it is already on, the deploy fails with `AlreadyExists` and rolls back. If it was enabled by hand, turn it off first with `aws xray update-trace-segment-destination --destination XRay`.
- Deploying waits several minutes for it to become active.
- Destroying the stack turns it off, including for other stacks that rely on it.

The builder creates:

- the `AWS::XRay::TransactionSearchConfig`, indexing 1% of spans as trace summaries by default. Raise it with `.indexingPercentage(...)`.
- a CloudWatch Logs resource policy that lets X-Ray write to `aws/spans` and `/aws/application-signals/data`. The policy is conditioned on this account's `aws:SourceAccount` and `aws:SourceArn`.

Spans are billed at CloudWatch Logs ingestion rates. See [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).
