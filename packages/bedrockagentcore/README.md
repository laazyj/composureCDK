# @composurecdk/bedrockagentcore

Amazon Bedrock AgentCore for [ComposureCDK](../../README.md): agent runtimes, with secure defaults, consumer-side grants and CloudWatch alarms.

It builds on the stable [`aws-cdk-lib/aws-bedrockagentcore`](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html) module. Model access comes from [`@composurecdk/bedrock`](../bedrock/README.md).

```ts
import { AgentCoreRuntime, AgentRuntimeArtifact } from "aws-cdk-lib/aws-bedrockagentcore";
import { FoundationModelIdentifier } from "aws-cdk-lib/aws-bedrock";
import { compose, ref } from "@composurecdk/core";
import { inferenceProfile, modelGrants } from "@composurecdk/bedrock";
import { createVpcBuilder, type VpcBuilderResult } from "@composurecdk/ec2";
import { createRuntimeBuilder } from "@composurecdk/bedrockagentcore";

const haiku = inferenceProfile.global(
  FoundationModelIdentifier.ANTHROPIC_CLAUDE_HAIKU_4_5_20251001_V1_0,
);

compose(
  {
    network: createVpcBuilder(),
    agent: createRuntimeBuilder()
      .runtimeName("support_agent")
      .agentRuntimeArtifact(
        AgentRuntimeArtifact.fromCodeAsset({
          path: "agent",
          runtime: AgentCoreRuntime.PYTHON_3_13,
          entrypoint: ["main.py"],
        }),
      )
      .vpc(ref<VpcBuilderResult>("network").get("vpc"))
      .environmentVariables({ MODEL_ID: haiku.profileId })
      .grant(modelGrants.invoke(haiku))
      .addEndpoint("prod", { version: "1" }),
  },
  { network: [], agent: ["network"] },
);
```

## Sources for the defaults

AWS's [recommended alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html) do not cover AgentCore. The defaults here come from:

- [Security Hub's AgentCore controls](https://docs.aws.amazon.com/securityhub/latest/userguide/bedrockagentcore-controls.html) (BedrockAgentCore.1–7), the only per-resource configuration rules AWS publishes.
- The [Well-Architected Agentic AI Lens](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentic-ai-lens.html), for tracing and monitoring.
- The [AgentCore Developer Guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/), for metrics, quotas and runtime security practices.

AWS publishes no AgentCore thresholds, so each threshold is this library's choice. Alarms with no universal baseline are opt-in and need a threshold.

## Runtimes

`createRuntimeBuilder()` wraps `Runtime`. Where it differs from CDK:

| Setting                      | Default                                                                              | Why                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Network                      | **None:** call `.vpc(…)`, or pass `RuntimeNetworkConfiguration.usingPublicNetwork()` | Public networking fails Security Hub BedrockAgentCore.1 (High)                     |
| VPC security group           | Outbound HTTPS only, from `@composurecdk/ec2`                                        | CDK's allows all outbound traffic                                                  |
| `tracingEnabled`             | `true`                                                                               | Agentic AI Lens AGENTOPS05-BP01                                                    |
| Endpoint log group retention | The `@composurecdk/logs` default, set on the service's log group                     | The service creates it with no retention and keeps it after the runtime is deleted |

A VPC-mode runtime needs interface endpoints for ECR (`ecr.api`, `ecr.dkr`) and CloudWatch Logs, and an S3 gateway endpoint, unless its subnets have a NAT route. See [VPC configuration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html).

Everything else is CDK's or the service's default: IAM (SigV4) inbound auth, a 15-minute idle session timeout, an 8-hour maximum lifetime, and CDK's execution role. That role can pull the artifact and write logs, traces and metrics. The agent's own access is granted with `.grant(...)`:

```ts
createRuntimeBuilder()
  // …
  .grant(modelGrants.invoke(haiku, { requireGuardrail: guardrail }));
```

`addEndpoint(name, { version })` adds a version-pinned endpoint, each with its own log group and alarms. For a runtime built elsewhere, use `createRuntimeEndpointBuilder()`.

### Invoking a runtime

`runtimeGrants.invoke` grants `bedrock-agentcore:InvokeAgentRuntime` on the runtime and its endpoints. `runtimeGrants.invokeForUser` grants `InvokeAgentRuntimeForUser`, which lets the caller name the user; grant it only to callers that need it.

```ts
createFunctionBuilder().grant(
  runtimeGrants.invoke(ref<RuntimeBuilderResult>("agent").get("runtime")),
);
```

## Alarms

Every alarm is on the `AWS/Bedrock-AgentCore` namespace with a 1-minute period. A runtime's alarms are created for each endpoint; custom alarms added with `addAlarm()` watch the `DEFAULT` endpoint.

| Alarm          | Default                                                                   | Metric, statistic   |
| -------------- | ------------------------------------------------------------------------- | ------------------- |
| `systemErrors` | On: > 0 in 3 of 5 minutes                                                 | `SystemErrors`, Sum |
| `throttles`    | On: > 0 in 3 of 5 minutes                                                 | `Throttles`, Sum    |
| `userErrors`   | Runtimes: on, > 0 in 3 of 5 minutes. Gateways: opt-in, threshold required | `UserErrors`, Sum   |
| `latency`      | Opt-in, threshold required (in ms)                                        | `Latency`, p90      |

An exception in the agent's own code is counted in a runtime's `UserErrors`, not `SystemErrors`, so the user-error alarm is what catches a failing agent. It also counts callers' mistakes, such as an unknown session.

```ts
createRuntimeBuilder().recommendedAlarms({
  latency: { threshold: 30_000 },
  throttles: false,
});
```
